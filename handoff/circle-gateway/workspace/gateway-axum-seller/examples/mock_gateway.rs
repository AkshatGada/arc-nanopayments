//! Deliberately fake loopback facilitator for the offline walkthrough.
//! It cannot verify signatures, move money, forward requests, or bind publicly.
use axum::{
    Json, Router,
    http::StatusCode,
    routing::{get, post},
};
use serde_json::{Value, json};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = Router::new()
        .route(
            "/v1/x402/supported",
            get(|| async {
                Json(
                    serde_json::from_str::<Value>(include_str!("../tests/fixtures/supported.json"))
                        .unwrap(),
                )
            }),
        )
        .route(
            "/v1/x402/settle",
            post(|Json(request): Json<Value>| async move {
                if request["paymentPayload"]["payload"]["signature"]
                    != "0xSYNTHETIC_NOT_A_SIGNATURE"
                    || request["paymentRequirements"]["network"] != "eip155:5042002"
                    || request["paymentRequirements"]["extra"]["name"] != "GatewayWalletBatched"
                {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(
                            json!({"error":"mock accepts only the synthetic walkthrough fixture"}),
                        ),
                    );
                }
                (
                    StatusCode::OK,
                    Json(
                        serde_json::from_str::<Value>(include_str!(
                            "../tests/fixtures/accepted.json"
                        ))
                        .unwrap(),
                    ),
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:4020").await?;
    println!("FAKE Gateway on 127.0.0.1:4020; no signatures verified and no payments made");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
