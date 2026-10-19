use gateway_axum_seller::{app, config::Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let app = app(&config).await?;
    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    println!(
        "Seller ready at {} (testnet, {} atomic USDC per quote)",
        config.resource_url(),
        config.amount
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
