//! Offline research probe against a loopback mock. No wallets or real payments.
use axum::{Router, Json, body::{Body, to_bytes}, http::{Request, StatusCode}, routing::{get, post}};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
use tower::ServiceExt;
use x402_axum::X402Middleware;
use x402_types::proto::v2;

#[tokio::main]
async fn main() {
    let requirements = json!({
        "scheme":"exact", "network":"eip155:5042002", "amount":"1",
        "asset":"0x3600000000000000000000000000000000000000",
        "payTo":"0x1111111111111111111111111111111111111111",
        "maxTimeoutSeconds":604800,
        "extra":{"name":"GatewayWalletBatched", "version":"1",
                 "verifyingContract":"0x0077777d7EBA4688BDeF3E311b846F25870A19B9"}
    });
    let payer = "0x2222222222222222222222222222222222222222";
    let transfer_id = "c9933054-6b34-44bb-8c04-e7e9e1b8352c";
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let calls = Arc::new(AtomicUsize::new(0));
    let outcome = Arc::new(AtomicUsize::new(0));
    let mock = Router::new()
        .route("/v1/x402/supported", get(|| async { Json(json!({"kinds":[],"extensions":[],"signers":{}})) }))
        .route("/v1/x402/settle", post({
            let seen=seen.clone(); let outcome=outcome.clone();
            move |Json(body): Json<Value>| {
                let seen=seen.clone(); let outcome=outcome.clone();
                async move {
                    seen.lock().unwrap().push(body);
                    let success=outcome.load(Ordering::SeqCst)==0;
                    Json(json!({"success":success,"network":"eip155:5042002",
                        "transaction":if success {transfer_id} else {""}, "payer":payer,
                        "errorReason":if success {Value::Null} else {json!("insufficient_balance")}}))
                }
            }
        }));
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr=listener.local_addr().unwrap();
    let server=tokio::spawn(async move {axum::serve(listener,mock).await.unwrap()});
    let price=v2::PriceTag{requirements:serde_json::from_value(requirements.clone()).unwrap(),enricher:None};
    // try_from normalizes a trailing slash. try_new(Url) does not.
    let x402=X402Middleware::try_from(format!("http://{addr}/v1/x402")).unwrap().settle_before_execution();
    let app=Router::new().route("/paid",get({
        let calls=calls.clone(); move || {let calls=calls.clone();async move {calls.fetch_add(1,Ordering::SeqCst);Json(json!({"ok":true}))}}
    }).layer(x402.with_price_tag(price)));
    let unpaid=app.clone().oneshot(Request::builder().uri("/paid").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(unpaid.status(),StatusCode::PAYMENT_REQUIRED);
    let required:Value=serde_json::from_slice(&STANDARD.decode(unpaid.headers()["payment-required"].as_bytes()).unwrap()).unwrap();
    assert_eq!(required["accepts"][0],requirements);
    assert_eq!(calls.load(Ordering::SeqCst),0);
    println!("PASS unpaid 402 preserves Gateway extra.verifyingContract; handler not run");
    let payload=json!({"x402Version":2,"accepted":requirements,"payload":{
        "signature":"0xFAKE_OFFLINE_FIXTURE", "authorization":{"from":payer,"to":requirements["payTo"],"value":"1",
        "validAfter":"0","validBefore":"2000000000","nonce":format!("0x{}","00".repeat(32))}
    }});
    let header=STANDARD.encode(serde_json::to_vec(&payload).unwrap());
    let paid_req=||Request::builder().uri("/paid").header("payment-signature",&header).body(Body::empty()).unwrap();
    let paid=app.clone().oneshot(paid_req()).await.unwrap();
    assert_eq!(paid.status(),StatusCode::OK);
    let receipt:Value=serde_json::from_slice(&STANDARD.decode(paid.headers()["payment-response"].as_bytes()).unwrap()).unwrap();
    assert_eq!(receipt["transaction"],transfer_id);
    assert_eq!(calls.load(Ordering::SeqCst),1);
    assert_eq!(seen.lock().unwrap()[0]["paymentRequirements"],requirements);
    assert_eq!(seen.lock().unwrap()[0]["paymentPayload"]["payload"],payload["payload"]);
    println!("PASS paid request forwarded to /v1/x402/settle; UUID receipt survives; no verify call needed");
    assert_eq!(to_bytes(paid.into_body(),10000).await.unwrap().as_ref(),br#"{"ok":true}"#);
    outcome.store(1,Ordering::SeqCst);
    let failed=app.clone().oneshot(paid_req()).await.unwrap();
    assert_eq!(failed.status(),StatusCode::PAYMENT_REQUIRED);
    assert_eq!(calls.load(Ordering::SeqCst),1);
    println!("PASS rejected settlement does not execute handler");
    let mut mismatch=payload.clone(); mismatch["accepted"]["amount"]=json!("0");
    let bad=app.oneshot(Request::builder().uri("/paid").header("payment-signature",STANDARD.encode(serde_json::to_vec(&mismatch).unwrap())).body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(bad.status(),StatusCode::PAYMENT_REQUIRED);
    assert_eq!(seen.lock().unwrap().len(),2);
    println!("PASS tampered accepted requirements rejected before facilitator call");
    server.abort();
}
