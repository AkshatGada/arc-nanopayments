//! Gateway's stricter HTTP contract, kept separate from the generic x402 client.
//! Never follow redirects or retry an authorization. Only HTTP 200 is a result.
use reqwest::{Client, Response, redirect, retry};
use serde_json::Value;
use url::Url;
use x402_types::proto::{self, SupportedResponse};

use crate::{Error, config::Config};

pub(crate) struct GatewayTransport {
    client: Client,
    base_url: Url,
    // Pin discovery to this seller instance. Its advertised price tag is static.
    supported: SupportedResponse,
}

impl GatewayTransport {
    pub(crate) async fn connect(config: &Config) -> Result<Self, Error> {
        let client = Client::builder()
            .redirect(redirect::Policy::none())
            .retry(retry::never())
            .timeout(config.timeout)
            .build()?;
        // Relative endpoint resolution needs exactly one final slash.
        let mut base_url = config.facilitator_url.clone();
        base_url.set_path(&format!("{}/", base_url.path().trim_end_matches('/')));
        let response = client.get(base_url.join("supported")?).send().await?;
        let supported = require_ok(response)?.json::<SupportedResponse>().await?;
        Ok(Self {
            client,
            base_url,
            supported,
        })
    }

    pub(crate) fn supported(&self) -> &SupportedResponse {
        &self.supported
    }

    pub(crate) async fn verify(
        &self,
        request: &proto::VerifyRequest,
    ) -> Result<proto::VerifyResponse, Error> {
        Ok(proto::VerifyResponse(self.post("verify", request).await?))
    }

    pub(crate) async fn settle(
        &self,
        request: &proto::SettleRequest,
    ) -> Result<proto::SettleResponse, Error> {
        Ok(proto::SettleResponse(self.post("settle", request).await?))
    }

    async fn post(&self, endpoint: &str, request: &proto::VerifyRequest) -> Result<Value, Error> {
        let response = self
            .client
            .post(self.base_url.join(endpoint)?)
            .json(request)
            .send()
            .await?;
        Ok(require_ok(response)?.json::<Value>().await?)
    }
}

fn require_ok(response: Response) -> Result<Response, Error> {
    if response.status() != reqwest::StatusCode::OK {
        // Do not parse an error/redirect body as an acceptance, or include its
        // potentially sensitive contents/Location in the error returned upstream.
        return Err(Error::GatewayStatus(response.status().as_u16()));
    }
    Ok(response)
}
