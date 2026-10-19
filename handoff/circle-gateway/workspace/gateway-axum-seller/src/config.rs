use std::{net::SocketAddr, time::Duration};
use url::Url;

use crate::Error;

pub const FACILITATOR_URL: &str = "https://gateway-api-testnet.circle.com/v1/x402/";
pub const GATEWAY_WALLET: &str = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
// Matches @circle-fin/x402-batching 3.5.0, rather than the conflicting manual guide.
pub const AUTHORIZATION_SECONDS: u64 = 7 * 24 * 60 * 60 + 100;

/// This teaching example deliberately offers only these two testnets.
#[derive(Clone, Copy, Debug)]
pub enum Network {
    ArcTestnet,
    BaseSepolia,
}

impl Network {
    pub fn id(self) -> &'static str {
        match self {
            Self::ArcTestnet => "eip155:5042002",
            Self::BaseSepolia => "eip155:84532",
        }
    }

    pub fn asset(self) -> &'static str {
        match self {
            Self::ArcTestnet => "0x3600000000000000000000000000000000000000",
            Self::BaseSepolia => "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub seller: String,
    pub network: Network,
    pub amount: u64,
    pub facilitator_url: Url,
    pub timeout: Duration,
    pub bind: SocketAddr,
    pub public_url: Url,
}

impl Config {
    pub fn from_env() -> Result<Self, Error> {
        Self::from_values(|key| std::env::var(key).ok())
    }

    /// Accept a lookup function so tests never mutate process-wide environment.
    pub fn from_values(get: impl Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let value = |key: &str, default: &str| get(key).unwrap_or_else(|| default.to_owned());
        let seller =
            get("SELLER_ADDRESS").ok_or_else(|| Error::config("SELLER_ADDRESS is required"))?;
        if !valid_address(&seller) || seller[2..].bytes().all(|b| b == b'0') {
            return Err(Error::config(
                "SELLER_ADDRESS must be a nonzero EVM address",
            ));
        }
        let network = match value("GATEWAY_NETWORK", "eip155:5042002").as_str() {
            "eip155:5042002" => Network::ArcTestnet,
            "eip155:84532" => Network::BaseSepolia,
            _ => {
                return Err(Error::config(
                    "GATEWAY_NETWORK must be Arc Testnet or Base Sepolia",
                ));
            }
        };
        let price = value("PRICE_ATOMIC", "1000");
        if price.is_empty() || !price.bytes().all(|b| b.is_ascii_digit()) {
            return Err(Error::config(
                "PRICE_ATOMIC must contain integer USDC atomic units",
            ));
        }
        let amount = price
            .parse::<u64>()
            .map_err(|_| Error::config("PRICE_ATOMIC overflows u64"))?;
        if !(1..=1_000_000).contains(&amount) {
            return Err(Error::config("PRICE_ATOMIC must be between 1 and 1000000"));
        }
        let facilitator_url = Url::parse(&value("GATEWAY_FACILITATOR_URL", FACILITATOR_URL))?;
        let local_mock = facilitator_url.scheme() == "http" && is_loopback(&facilitator_url);
        let circle = facilitator_url.scheme() == "https"
            && facilitator_url.host_str() == Some("gateway-api-testnet.circle.com")
            && facilitator_url.port().is_none();
        if !(local_mock || circle)
            || facilitator_url.path().trim_end_matches('/') != "/v1/x402"
            || !clean_url(&facilitator_url)
        {
            return Err(Error::config(
                "use Circle testnet /v1/x402/ or an HTTP loopback mock",
            ));
        }
        let timeout_ms = value("GATEWAY_TIMEOUT_MS", "5000")
            .parse::<u64>()
            .map_err(|_| Error::config("GATEWAY_TIMEOUT_MS must be an integer"))?;
        if !(10..=30_000).contains(&timeout_ms) {
            return Err(Error::config(
                "GATEWAY_TIMEOUT_MS must be between 10 and 30000",
            ));
        }
        let bind = value("BIND_ADDRESS", "127.0.0.1:3000")
            .parse()
            .map_err(|_| Error::config("BIND_ADDRESS must be an IP socket address"))?;
        let public_url = Url::parse(&value("PUBLIC_URL", "http://127.0.0.1:3000/"))?;
        if !(public_url.scheme() == "https"
            || (public_url.scheme() == "http" && is_loopback(&public_url)))
            || !clean_url(&public_url)
            || public_url.path() != "/"
        {
            return Err(Error::config(
                "PUBLIC_URL must be an HTTPS origin or HTTP loopback origin",
            ));
        }
        Ok(Self {
            seller,
            network,
            amount,
            facilitator_url,
            timeout: Duration::from_millis(timeout_ms),
            bind,
            public_url,
        })
    }

    pub fn resource_url(&self) -> Url {
        self.public_url
            .join("quote")
            .expect("validated HTTP origin")
    }
}

pub(crate) fn valid_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_loopback(url: &Url) -> bool {
    matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(url::Host::Ipv6(ip)) if ip.is_loopback())
}

fn clean_url(url: &Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}
