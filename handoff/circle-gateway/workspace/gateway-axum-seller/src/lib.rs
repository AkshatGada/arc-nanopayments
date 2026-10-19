//! Native Axum seller using x402-rs and Circle's hosted Gateway API.
//! No wallet keys, signature implementation, or automatic payment retries.
pub mod config;
mod transport;

use axum::{
    Extension, Json, Router,
    body::Body,
    http::{Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use config::{AUTHORIZATION_SECONDS, Config, GATEWAY_WALLET, valid_address};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use transport::GatewayTransport;
use uuid::Uuid;
use x402_axum::X402Middleware;
use x402_types::{
    facilitator::Facilitator,
    proto::{self, SupportedResponse, v2},
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Configuration(String),
    #[error("invalid URL: {0}")]
    Url(#[from] url::ParseError),
    #[error("Gateway discovery or request failed")]
    Gateway(#[from] reqwest::Error),
    #[error("Gateway returned HTTP {0}; expected HTTP 200")]
    GatewayStatus(u16),
    #[error("invalid Gateway settlement response")]
    InvalidReceipt,
}

impl Error {
    pub(crate) fn config(message: &str) -> Self {
        Self::Configuration(message.to_owned())
    }
}

/// Startup discovery is mandatory. An unreachable or incompatible Gateway
/// fails startup rather than silently offering unsupported payment terms.
pub async fn app(config: &Config) -> Result<Router, Error> {
    app_with_counter(config, Arc::new(AtomicUsize::new(0))).await
}

/// A counter provides observable proof that failure paths never run the handler.
pub async fn app_with_counter(
    config: &Config,
    fulfilled: Arc<AtomicUsize>,
) -> Result<Router, Error> {
    let transport = GatewayTransport::connect(config).await?;
    let requirements = payment_requirements(config, transport.supported())?;
    let facilitator = GatewayFacilitator {
        transport,
        network: config.network.id().to_owned(),
    };
    let x402 = X402Middleware::from_facilitator(Arc::new(facilitator)).settle_before_execution();
    let price = v2::PriceTag {
        requirements,
        enricher: None,
    };
    let payment_rail = if config.facilitator_url.scheme() == "http" {
        "loopback_mock"
    } else {
        "circle_testnet"
    };

    Ok(Router::new()
        .route("/health", get(move || async move { Json(json!({"status":"ready", "paymentRail":payment_rail})) }))
        .route("/quote", get(move |Extension(receipt): Extension<Option<proto::SettleResponse>>| {
            let fulfilled = fulfilled.clone();
            async move {
                // settle_before_execution inserts this only after acceptance.
                let receipt = receipt.expect("settlement-before-execution invariant");
                fulfilled.fetch_add(1, Ordering::SeqCst);
                Json(json!({
                    "quote": "Small steps make progress.",
                    "payment": {"status":"accepted", "transferId":receipt.0["transaction"], "network":receipt.0["network"]}
                }))
            }
        }).layer(x402.with_price_tag(price)
            .with_resource(config.resource_url())
            .with_mime_type("application/json".to_owned())
            .with_description("One read-only quote; Gateway acceptance precedes delivery".to_owned())))
        .layer(middleware::from_fn(response_policy)))
}

pub fn payment_requirements(
    config: &Config,
    supported: &SupportedResponse,
) -> Result<v2::PaymentRequirements, Error> {
    let kind = supported
        .kinds
        .iter()
        .find(|kind| {
            let extra = kind.extra.as_ref();
            kind.x402_version == 2
                && kind.scheme == "exact"
                && kind.network == config.network.id()
                && extra
                    .and_then(|e| e["verifyingContract"].as_str())
                    .is_some_and(|v| v.eq_ignore_ascii_case(GATEWAY_WALLET))
                && extra
                    .and_then(|e| e.get("name"))
                    .is_none_or(|v| v == "GatewayWalletBatched")
                && extra
                    .and_then(|e| e.get("version"))
                    .is_none_or(|v| v == "1")
        })
        .ok_or_else(|| {
            Error::config("Gateway did not advertise the configured testnet batching contract")
        })?;
    let mut extra = kind
        .extra
        .clone()
        .expect("matching kind has an extra object");
    extra["name"] = json!("GatewayWalletBatched");
    extra["version"] = json!("1");
    // Canonical address casing keeps the advertised offer stable across requests.
    extra["verifyingContract"] = json!(GATEWAY_WALLET);
    Ok(v2::PaymentRequirements {
        scheme: "exact".into(),
        network: config.network.id().parse().expect("static CAIP-2 network"),
        asset: config.network.asset().into(),
        amount: config.amount.to_string(),
        pay_to: config.seller.clone(),
        max_timeout_seconds: AUTHORIZATION_SECONDS,
        extra: Some(extra),
    })
}

/// Validate the hosted acceptance receipt before the generic paygate releases
/// the resource. UUIDs remain opaque references; they are never explorer hashes.
struct GatewayFacilitator {
    transport: GatewayTransport,
    network: String,
}

impl Facilitator for GatewayFacilitator {
    type Error = Error;

    async fn supported(&self) -> Result<SupportedResponse, Error> {
        Ok(self.transport.supported().clone())
    }
    async fn verify(&self, request: &proto::VerifyRequest) -> Result<proto::VerifyResponse, Error> {
        self.transport.verify(request).await
    }
    async fn settle(&self, request: &proto::SettleRequest) -> Result<proto::SettleResponse, Error> {
        let result = self.transport.settle(request).await?;
        if result.0.get("success").and_then(Value::as_bool) == Some(true) {
            let response = &result.0;
            let payer = response
                .get("payer")
                .and_then(Value::as_str)
                .ok_or(Error::InvalidReceipt)?;
            let submitted: Value =
                serde_json::from_str(request.as_str()).map_err(|_| Error::InvalidReceipt)?;
            let from = submitted["paymentPayload"]["payload"]["authorization"]["from"]
                .as_str()
                .ok_or(Error::InvalidReceipt)?;
            let id = response
                .get("transaction")
                .and_then(Value::as_str)
                .ok_or(Error::InvalidReceipt)?;
            if response["network"] != self.network
                || !valid_address(payer)
                || !payer.eq_ignore_ascii_case(from)
                || Uuid::parse_str(id).is_err()
                || id.len() != 36
            {
                return Err(Error::InvalidReceipt);
            }
        }
        Ok(result)
    }
}

async fn response_policy(request: Request<Body>, next: Next) -> Response {
    // Axum's GET router also accepts HEAD. Reject it before the paygate so a
    // signed HEAD cannot settle a payment while returning no quote body.
    let mut response = if request.uri().path() == "/quote" && request.method() != Method::GET {
        (
            StatusCode::METHOD_NOT_ALLOWED,
            [(header::ALLOW, "GET")],
            Json(json!({"error":"method_not_allowed"})),
        )
            .into_response()
    } else {
        next.run(request).await
    };
    // Upstream currently maps settlement/transport errors to a bare 402 without
    // a new offer. Do not turn an ambiguous payment outcome into a fresh charge.
    if response.status() == StatusCode::PAYMENT_REQUIRED
        && !response.headers().contains_key("payment-required")
    {
        response = (StatusCode::BAD_GATEWAY, Json(json!({
            "error":"gateway_payment_unavailable",
            "message":"No resource was served. Do not sign a new payment automatically; an uncertain outcome needs reconciliation using the original authorization.",
            "automaticRetry":false
        }))).into_response();
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}
