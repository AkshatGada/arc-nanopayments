//! Synthetic fixtures over a real loopback HTTP transport. No Circle calls.
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use gateway_axum_seller::{
    app_with_counter,
    config::{AUTHORIZATION_SECONDS, Config},
};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;
use tower::ServiceExt;

const PAYER: &str = "0x2222222222222222222222222222222222222222";
const TRANSFER: &str = "c9933054-6b34-44bb-8c04-e7e9e1b8352c";

#[derive(Clone)]
struct Reply {
    status: StatusCode,
    body: String,
    delay: Duration,
}
impl Reply {
    fn json(value: Value) -> Self {
        Self {
            status: StatusCode::OK,
            body: value.to_string(),
            delay: Duration::ZERO,
        }
    }
}
#[derive(Clone)]
struct MockState {
    supported: Arc<Mutex<Reply>>,
    settlement: Arc<Mutex<Reply>>,
    requests: Arc<Mutex<Vec<Value>>>,
    verifies: Arc<AtomicUsize>,
}
struct MockGateway {
    url: String,
    state: MockState,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for MockGateway {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl MockGateway {
    async fn start() -> Self {
        let state = MockState {
            supported: Arc::new(Mutex::new(Reply::json(supported()))),
            settlement: Arc::new(Mutex::new(Reply::json(accepted()))),
            requests: Arc::new(Mutex::new(vec![])),
            verifies: Arc::new(AtomicUsize::new(0)),
        };
        let router = Router::new()
            .route(
                "/v1/x402/supported",
                get(|State(s): State<MockState>| async move {
                    let reply = s.supported.lock().unwrap().clone();
                    respond(reply).await
                }),
            )
            .route(
                "/v1/x402/settle",
                post(
                    |State(s): State<MockState>, Json(body): Json<Value>| async move {
                        s.requests.lock().unwrap().push(body);
                        let reply = s.settlement.lock().unwrap().clone();
                        respond(reply).await
                    },
                ),
            )
            .route(
                "/v1/x402/verify",
                post(|State(s): State<MockState>| async move {
                    s.verifies.fetch_add(1, Ordering::SeqCst);
                    StatusCode::INTERNAL_SERVER_ERROR
                }),
            )
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/x402", listener.local_addr().unwrap()); // deliberately no trailing slash
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self { url, state, task }
    }
    fn config(&self) -> Config {
        Config::from_values(|key| match key {
            "SELLER_ADDRESS" => Some("0x1111111111111111111111111111111111111111".into()),
            "GATEWAY_FACILITATOR_URL" => Some(self.url.clone()),
            _ => None,
        })
        .unwrap()
    }
    async fn seller(&self) -> (Router, Arc<AtomicUsize>) {
        let fulfilled = Arc::new(AtomicUsize::new(0));
        (
            app_with_counter(&self.config(), fulfilled.clone())
                .await
                .unwrap(),
            fulfilled,
        )
    }
    fn requests(&self) -> Vec<Value> {
        self.state.requests.lock().unwrap().clone()
    }
}
async fn respond(reply: Reply) -> Response {
    tokio::time::sleep(reply.delay).await;
    (
        reply.status,
        [("content-type", "application/json")],
        reply.body,
    )
        .into_response()
}
fn supported() -> Value {
    serde_json::from_str(include_str!("fixtures/supported.json")).unwrap()
}
fn accepted() -> Value {
    serde_json::from_str(include_str!("fixtures/accepted.json")).unwrap()
}
async fn body(response: Response) -> Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 100_000).await.unwrap()).unwrap()
}
fn decode(response: &Response, header: &str) -> Value {
    serde_json::from_slice(
        &STANDARD
            .decode(response.headers()[header].as_bytes())
            .unwrap(),
    )
    .unwrap()
}
async fn call(app: &Router, payment: Option<&str>) -> Response {
    let mut request = Request::builder().uri("/quote");
    if let Some(value) = payment {
        request = request.header("payment-signature", value);
    }
    app.clone()
        .oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}
async fn payload(app: &Router) -> Value {
    let challenge = call(app, None).await;
    let terms = decode(&challenge, "payment-required");
    json!({"x402Version":2, "resource":terms["resource"], "accepted":terms["accepts"][0],
    "payload":{"signature":"0xSYNTHETIC_NOT_A_SIGNATURE", "authorization":{
        "from":PAYER,"to":terms["accepts"][0]["payTo"],"value":terms["accepts"][0]["amount"],
        "validAfter":"0","validBefore":"2000000000","nonce":format!("0x{}", "00".repeat(32))
    }}})
}
fn encode(value: &Value) -> String {
    STANDARD.encode(serde_json::to_vec(value).unwrap())
}

#[tokio::test]
async fn challenge_preserves_gateway_domain_integer_price_and_resource() {
    let mock = MockGateway::start().await;
    let (app, fulfilled) = mock.seller().await;
    let response = call(&app, None).await;
    assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let challenge = decode(&response, "payment-required");
    assert_eq!(challenge["x402Version"], 2);
    assert_eq!(challenge["resource"]["url"], "http://127.0.0.1:3000/quote");
    assert_eq!(challenge["resource"]["mimeType"], "application/json");
    assert_eq!(challenge["accepts"].as_array().unwrap().len(), 1);
    let offer = &challenge["accepts"][0];
    assert_eq!(offer["scheme"], "exact");
    assert_eq!(offer["amount"], "1000");
    assert_eq!(offer["asset"], "0x3600000000000000000000000000000000000000");
    assert_eq!(offer["maxTimeoutSeconds"], AUTHORIZATION_SECONDS);
    assert_eq!(offer["extra"], supported()["kinds"][0]["extra"]);
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
    assert!(mock.requests().is_empty());
}

#[tokio::test]
async fn accepted_payment_is_forwarded_once_and_receipt_remains_an_acceptance() {
    let mock = MockGateway::start().await;
    let (app, fulfilled) = mock.seller().await;
    let payment = payload(&app).await;
    let response = call(&app, Some(&encode(&payment))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(decode(&response, "payment-response"), accepted());
    let content = body(response).await;
    assert_eq!(
        content["payment"],
        json!({"status":"accepted","transferId":TRANSFER,"network":"eip155:5042002"})
    );
    assert!(content["payment"].get("txHash").is_none());
    assert!(content["payment"].get("settledAt").is_none());
    assert_eq!(fulfilled.load(Ordering::SeqCst), 1);
    let requests = mock.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["paymentRequirements"], payment["accepted"]);
    assert_eq!(requests[0]["paymentPayload"], payment);
    assert_eq!(mock.state.verifies.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn altered_payment_terms_never_reach_gateway_or_handler() {
    let mock = MockGateway::start().await;
    let (app, fulfilled) = mock.seller().await;
    let original = payload(&app).await;
    for (field, value) in [
        ("amount", json!("1")),
        ("payTo", json!(PAYER)),
        ("network", json!("eip155:8453")),
        ("asset", json!(PAYER)),
        ("scheme", json!("batch-settlement")),
        ("maxTimeoutSeconds", json!(1)),
    ] {
        let mut modified = original.clone();
        modified["accepted"][field] = value;
        let response = call(&app, Some(&encode(&modified))).await;
        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED, "{field}");
    }
    for (field, value) in [
        ("name", "USD Coin"),
        ("version", "2"),
        ("verifyingContract", PAYER),
    ] {
        let mut modified = original.clone();
        modified["accepted"]["extra"][field] = json!(value);
        assert_eq!(
            call(&app, Some(&encode(&modified))).await.status(),
            StatusCode::PAYMENT_REQUIRED
        );
    }
    assert!(mock.requests().is_empty());
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn malformed_and_legacy_headers_never_reach_gateway() {
    let mock = MockGateway::start().await;
    let (app, fulfilled) = mock.seller().await;
    for header in [
        "%%%".to_owned(),
        STANDARD.encode("not-json"),
        encode(&json!([])),
        encode(&json!({"x402Version":1,"payload":{}})),
        encode(&json!({"x402Version":2,"payload":{}})),
    ] {
        assert_eq!(
            call(&app, Some(&header)).await.status(),
            StatusCode::PAYMENT_REQUIRED
        );
    }
    let request = Request::builder()
        .uri("/quote")
        .header("x-payment", "legacy-only")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::PAYMENT_REQUIRED
    );
    assert!(mock.requests().is_empty());
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn gateway_rejection_prevents_fulfillment_and_does_not_issue_a_new_offer() {
    let mock = MockGateway::start().await;
    *mock.state.settlement.lock().unwrap() =
        Reply::json(serde_json::from_str(include_str!("fixtures/rejected.json")).unwrap());
    let (app, fulfilled) = mock.seller().await;
    let payment = payload(&app).await;
    let response = call(&app, Some(&encode(&payment))).await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(!response.headers().contains_key("payment-required"));
    assert!(!response.headers().contains_key("payment-response"));
    assert_eq!(body(response).await["automaticRetry"], false);
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
    assert_eq!(mock.requests().len(), 1);
}

#[tokio::test]
async fn invalid_success_receipts_are_not_treated_as_payment_acceptance() {
    for (field, value) in [
        ("network", json!("eip155:84532")),
        ("transaction", json!("0x1234")),
        ("transaction", Value::Null),
        ("payer", Value::Null),
        ("payer", json!("0x3333333333333333333333333333333333333333")),
        ("success", json!("true")),
        ("success", Value::Null),
    ] {
        let mock = MockGateway::start().await;
        let mut receipt = accepted();
        receipt[field] = value;
        *mock.state.settlement.lock().unwrap() = Reply::json(receipt);
        let (app, fulfilled) = mock.seller().await;
        let payment = payload(&app).await;
        assert_eq!(
            call(&app, Some(&encode(&payment))).await.status(),
            StatusCode::BAD_GATEWAY,
            "{field}"
        );
        assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
        assert_eq!(mock.requests().len(), 1);
    }
}

#[tokio::test]
async fn infrastructure_and_parse_errors_are_redacted_and_not_retried() {
    for reply in [
        Reply {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            body: "PRIVATE_UPSTREAM_DETAILS".into(),
            delay: Duration::ZERO,
        },
        Reply {
            status: StatusCode::OK,
            body: "PRIVATE_UPSTREAM_DETAILS".into(),
            delay: Duration::ZERO,
        },
        Reply {
            status: StatusCode::TOO_MANY_REQUESTS,
            body: "limited".into(),
            delay: Duration::ZERO,
        },
        // Even success:true is not acceptance when the upstream HTTP status is 500.
        Reply {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            body: accepted().to_string(),
            delay: Duration::ZERO,
        },
    ] {
        let mock = MockGateway::start().await;
        *mock.state.settlement.lock().unwrap() = reply;
        let (app, fulfilled) = mock.seller().await;
        let payment = payload(&app).await;
        let response = call(&app, Some(&encode(&payment))).await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert!(
            !body(response)
                .await
                .to_string()
                .contains("PRIVATE_UPSTREAM_DETAILS")
        );
        assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
        assert_eq!(mock.requests().len(), 1);
    }
}

#[tokio::test]
async fn timeout_after_submission_is_unknown_and_does_not_trigger_second_settlement() {
    let mock = MockGateway::start().await;
    mock.state.settlement.lock().unwrap().delay = Duration::from_millis(300);
    let mut config = mock.config();
    config.timeout = Duration::from_millis(50);
    let fulfilled = Arc::new(AtomicUsize::new(0));
    let app = app_with_counter(&config, fulfilled.clone()).await.unwrap();
    let payment = payload(&app).await;
    let response = call(&app, Some(&encode(&payment))).await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert!(!response.headers().contains_key("payment-required"));
    assert_eq!(body(response).await["automaticRetry"], false);
    assert_eq!(mock.requests().len(), 1); // Gateway saw it; its final result is unknown to seller.
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn discovery_requires_the_configured_network_scheme_version_and_contract() {
    for (field, value) in [
        ("network", json!("eip155:8453")),
        ("scheme", json!("batch-settlement")),
        ("x402Version", json!(1)),
        ("extra", json!({"name":"USD Coin","version":"2"})),
        (
            "extra",
            json!({"name":"GatewayWalletBatched","version":"1","verifyingContract":PAYER}),
        ),
        (
            "extra",
            json!({"name":"USD Coin","version":"1","verifyingContract":gateway_axum_seller::config::GATEWAY_WALLET}),
        ),
    ] {
        let mock = MockGateway::start().await;
        let mut kinds = supported();
        kinds["kinds"][0][field] = value;
        *mock.state.supported.lock().unwrap() = Reply::json(kinds);
        assert!(
            gateway_axum_seller::app(&mock.config()).await.is_err(),
            "{field}"
        );
    }
}

#[tokio::test]
async fn discovery_supports_contract_only_metadata_and_preserves_additional_fields() {
    let mock = MockGateway::start().await;
    let mut kinds = supported();
    kinds["kinds"][0]["extra"]
        .as_object_mut()
        .unwrap()
        .remove("name");
    kinds["kinds"][0]["extra"]
        .as_object_mut()
        .unwrap()
        .remove("version");
    kinds["kinds"][0]["extra"]["fixtureFutureField"] = json!({"retained":true});
    *mock.state.supported.lock().unwrap() = Reply::json(kinds);
    let (app, _) = mock.seller().await;
    let offer = decode(&call(&app, None).await, "payment-required")["accepts"][0].clone();
    assert_eq!(offer["extra"]["name"], "GatewayWalletBatched");
    assert_eq!(offer["extra"]["version"], "1");
    assert_eq!(
        offer["extra"]["fixtureFutureField"],
        json!({"retained":true})
    );
}

#[tokio::test]
async fn failed_or_malformed_discovery_does_not_start_a_seller() {
    for reply in [
        Reply {
            status: StatusCode::FORBIDDEN,
            body: "forbidden".into(),
            delay: Duration::ZERO,
        },
        Reply {
            status: StatusCode::OK,
            body: "not-json".into(),
            delay: Duration::ZERO,
        },
        Reply::json(json!({"kinds":[]})),
    ] {
        let mock = MockGateway::start().await;
        *mock.state.supported.lock().unwrap() = reply;
        assert!(gateway_axum_seller::app(&mock.config()).await.is_err());
        assert!(mock.requests().is_empty());
    }
}

#[test]
fn configuration_rejects_wrong_networks_money_formats_and_remote_mocks() {
    for (key, value) in [
        ("SELLER_ADDRESS", "0x0"),
        (
            "SELLER_ADDRESS",
            "0x0000000000000000000000000000000000000000",
        ),
        ("GATEWAY_NETWORK", "eip155:8453"),
        ("GATEWAY_NETWORK", "solana:devnet"),
        ("PRICE_ATOMIC", "0"),
        ("PRICE_ATOMIC", "1.5"),
        ("PRICE_ATOMIC", "+1"),
        ("PRICE_ATOMIC", "1000001"),
        ("PRICE_ATOMIC", "18446744073709551616"),
        ("GATEWAY_TIMEOUT_MS", "0"),
        (
            "GATEWAY_FACILITATOR_URL",
            "https://gateway-api.circle.com/v1/x402/",
        ),
        ("GATEWAY_FACILITATOR_URL", "http://example.com/v1/x402/"),
        ("GATEWAY_FACILITATOR_URL", "http://127.0.0.1:4020/wrong/"),
        (
            "GATEWAY_FACILITATOR_URL",
            "http://user:password@127.0.0.1:4020/v1/x402/",
        ),
        ("PUBLIC_URL", "https://example.com/path"),
        ("PUBLIC_URL", "https://example.com/?query=1"),
    ] {
        let config = Config::from_values(|name| {
            if name == key {
                Some(value.into())
            } else if name == "SELLER_ADDRESS" {
                Some(PAYER.into())
            } else {
                None
            }
        });
        assert!(config.is_err(), "{key}={value}");
    }
}

#[tokio::test]
async fn base_sepolia_offer_uses_its_own_asset_and_never_advertises_arc() {
    let mock = MockGateway::start().await;
    let mut kinds = supported();
    kinds["kinds"][0]["network"] = json!("eip155:84532");
    *mock.state.supported.lock().unwrap() = Reply::json(kinds);
    let mut config = mock.config();
    config.network = gateway_axum_seller::config::Network::BaseSepolia;
    let app = gateway_axum_seller::app(&config).await.unwrap();
    let terms = decode(&call(&app, None).await, "payment-required");
    assert_eq!(terms["accepts"][0]["network"], "eip155:84532");
    assert_eq!(
        terms["accepts"][0]["asset"],
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    );
}

#[tokio::test]
async fn signed_head_post_and_options_cannot_trigger_a_payment() {
    let mock = MockGateway::start().await;
    let (app, fulfilled) = mock.seller().await;
    let payment = encode(&payload(&app).await);
    for method in ["HEAD", "POST", "OPTIONS"] {
        let request = Request::builder()
            .method(method)
            .uri("/quote")
            .header("payment-signature", &payment)
            .body(Body::empty())
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
        assert_eq!(response.headers()["allow"], "GET");
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
    assert!(mock.requests().is_empty());
    assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn transport_rejects_non_200_success_bodies() {
    for status in [
        StatusCode::BAD_REQUEST,
        StatusCode::PRECONDITION_FAILED,
        StatusCode::CREATED,
        StatusCode::ACCEPTED,
        StatusCode::MOVED_PERMANENTLY,
        StatusCode::FOUND,
        StatusCode::SEE_OTHER,
        StatusCode::TEMPORARY_REDIRECT,
        StatusCode::PERMANENT_REDIRECT,
    ] {
        let mock = MockGateway::start().await;
        *mock.state.settlement.lock().unwrap() = Reply {
            status,
            body: accepted().to_string(),
            delay: Duration::ZERO,
        };
        let (app, fulfilled) = mock.seller().await;
        let payment = payload(&app).await;
        let response = call(&app, Some(&encode(&payment))).await;
        assert_eq!(
            response.status(),
            StatusCode::BAD_GATEWAY,
            "upstream {status}"
        );
        assert!(!response.headers().contains_key("payment-required"));
        assert!(!response.headers().contains_key("payment-response"));
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(body(response).await["automaticRetry"], false);
        assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
        assert_eq!(mock.requests().len(), 1);
    }
}

struct RedirectMock {
    url: String,
    destination_calls: Arc<AtomicUsize>,
    source: tokio::task::JoinHandle<()>,
    destination: tokio::task::JoinHandle<()>,
}

impl Drop for RedirectMock {
    fn drop(&mut self) {
        self.source.abort();
        self.destination.abort();
    }
}

impl RedirectMock {
    async fn start(status: StatusCode, discovery: bool) -> Self {
        let destination_calls = Arc::new(AtomicUsize::new(0));
        let captured = destination_calls.clone();
        let destination = Router::new().route(
            "/capture",
            any(move || {
                let captured = captured.clone();
                async move {
                    captured.fetch_add(1, Ordering::SeqCst);
                    Json(if discovery { supported() } else { accepted() })
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let location = format!("http://{}/capture", listener.local_addr().unwrap());
        let destination =
            tokio::spawn(async move { axum::serve(listener, destination).await.unwrap() });
        let discovery_location = location.clone();
        let source = Router::new()
            .route(
                "/v1/x402/supported",
                get(move || {
                    let location = discovery_location.clone();
                    async move {
                        if discovery {
                            (status, [("location", location)], Json(supported())).into_response()
                        } else {
                            Json(supported()).into_response()
                        }
                    }
                }),
            )
            .route(
                "/v1/x402/settle",
                post(move || {
                    let location = location.clone();
                    async move { (status, [("location", location)], Json(accepted())) }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/x402/", listener.local_addr().unwrap());
        let source = tokio::spawn(async move { axum::serve(listener, source).await.unwrap() });
        Self {
            url,
            destination_calls,
            source,
            destination,
        }
    }

    fn config(&self) -> Config {
        Config::from_values(|key| match key {
            "SELLER_ADDRESS" => Some("0x1111111111111111111111111111111111111111".into()),
            "GATEWAY_FACILITATOR_URL" => Some(self.url.clone()),
            _ => None,
        })
        .unwrap()
    }
}

#[tokio::test]
async fn transport_does_not_follow_settlement_redirects() {
    for status in [
        StatusCode::TEMPORARY_REDIRECT,
        StatusCode::PERMANENT_REDIRECT,
        StatusCode::MOVED_PERMANENTLY,
        StatusCode::FOUND,
        StatusCode::SEE_OTHER,
    ] {
        let mock = RedirectMock::start(status, false).await;
        let fulfilled = Arc::new(AtomicUsize::new(0));
        let app = app_with_counter(&mock.config(), fulfilled.clone())
            .await
            .unwrap();
        let payment = payload(&app).await;
        let response = call(&app, Some(&encode(&payment))).await;
        assert_eq!(
            mock.destination_calls.load(Ordering::SeqCst),
            0,
            "upstream {status}"
        );
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert!(!response.headers().contains_key("payment-required"));
        assert!(!response.headers().contains_key("payment-response"));
        assert_eq!(fulfilled.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn transport_does_not_follow_discovery_redirects() {
    for status in [
        StatusCode::TEMPORARY_REDIRECT,
        StatusCode::PERMANENT_REDIRECT,
        StatusCode::MOVED_PERMANENTLY,
        StatusCode::FOUND,
        StatusCode::SEE_OTHER,
    ] {
        let mock = RedirectMock::start(status, true).await;
        let result = gateway_axum_seller::app(&mock.config()).await;
        assert_eq!(
            mock.destination_calls.load(Ordering::SeqCst),
            0,
            "upstream {status}"
        );
        assert!(result.is_err(), "upstream {status}");
    }
}
