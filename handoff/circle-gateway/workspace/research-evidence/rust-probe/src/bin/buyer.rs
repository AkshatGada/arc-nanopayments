//! Captures the digest requested by the actual Rust buyer. No key and no network.
use alloy_primitives::{Address, FixedBytes, Signature, U256, address};
use alloy_sol_types::{SolStruct,eip712_domain};
use async_trait::async_trait;
use base64::{Engine,engine::general_purpose::STANDARD};
use serde_json::{Value,json};
use std::sync::{Arc,Mutex};
use x402_chain_eip155::{V2Eip155ExactClient,v1_eip155_exact::{TransferWithAuthorization,client::SignerLike}};
use x402_types::{proto::PaymentRequired,scheme::client::X402SchemeClient};

#[derive(Clone)]
struct DigestRecorder(Arc<Mutex<Option<FixedBytes<32>>>>);
#[async_trait]
impl SignerLike for DigestRecorder {
 fn address(&self)->Address {address!("2222222222222222222222222222222222222222")}
 async fn sign_hash(&self,hash:&FixedBytes<32>)->Result<Signature,alloy_signer::Error>{
  *self.0.lock().unwrap()=Some(*hash);
  Ok(Signature::new(U256::from(1),U256::from(1),false)) // deliberately non-valid fixture signature
 }
}
#[tokio::main]
async fn main(){
 let req=json!({"x402Version":2,"accepts":[{"scheme":"exact","network":"eip155:5042002",
  "amount":"1","asset":"0x3600000000000000000000000000000000000000",
  "payTo":"0x1111111111111111111111111111111111111111","maxTimeoutSeconds":604900,
  "extra":{"name":"GatewayWalletBatched","version":"1","verifyingContract":"0x0077777d7EBA4688BDeF3E311b846F25870A19B9"}}]});
 let req_text=serde_json::to_string(&req).unwrap();
 let parsed=PaymentRequired::V2(serde_json::from_str(&req_text).unwrap());
 let recorder=DigestRecorder(Arc::new(Mutex::new(None)));
 let client=V2Eip155ExactClient::new(recorder.clone());
 let candidates=client.accept(&parsed);
 assert_eq!(candidates.len(),1);
 println!("CONFIRMED Rust standard exact client accepts GatewayWalletBatched as a candidate");
 let signed=candidates[0].signer.sign_payment().await.unwrap();
 let body:Value=serde_json::from_slice(&STANDARD.decode(signed).unwrap()).unwrap();
 let auth=&body["payload"]["authorization"];
 let t=TransferWithAuthorization{from:auth["from"].as_str().unwrap().parse().unwrap(),
  to:auth["to"].as_str().unwrap().parse().unwrap(),value:U256::from(1),
  validAfter:U256::from_str_radix(auth["validAfter"].as_str().unwrap(),10).unwrap(),
  validBefore:U256::from_str_radix(auth["validBefore"].as_str().unwrap(),10).unwrap(),
  nonce:auth["nonce"].as_str().unwrap().parse().unwrap()};
 let actual=recorder.0.lock().unwrap().unwrap();
 let token_domain=eip712_domain!{name:"GatewayWalletBatched",version:"1",chain_id:5042002,
  verifying_contract:address!("3600000000000000000000000000000000000000"),};
 let gateway_domain=eip712_domain!{name:"GatewayWalletBatched",version:"1",chain_id:5042002,
  verifying_contract:address!("0077777d7EBA4688BDeF3E311b846F25870A19B9"),};
 assert_eq!(actual,t.eip712_signing_hash(&token_domain));
 assert_ne!(actual,t.eip712_signing_hash(&gateway_domain));
 assert_eq!(body["accepted"]["extra"]["verifyingContract"],"0x0077777d7EBA4688BDeF3E311b846F25870A19B9");
 println!("CONFIRMED requested digest uses USDC token as verifyingContract, not GatewayWallet");
 println!("CONFIRMED accepted metadata is preserved, so correcting signing/routing is the actual gap");
}
