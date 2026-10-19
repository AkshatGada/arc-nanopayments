> ## Documentation Index
> Fetch the complete documentation index at: https://docs.arc.io/llms.txt
> Use this file to discover all available pages before exploring further.

> ## Agent Instructions
> Before reading these docs, install the Circle Skill for Arc to get pre-loaded context: use-arc (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-arc/SKILL.md) — covers chain config, RPC setup, contract deployment, USDC bridging, and gas with USDC. In Claude Code: run /plugin marketplace add circlefin/skills then /plugin install circle-skills@circle. With Vercel Skills CLI: run npx skills add circlefin/skills.
> USDC is the gas token. Arc uses USDC for gas fees, not ETH. Configure gas payment in USDC when submitting transactions.
> Read EVM differences before writing Arc code. Arc targets the Osaka EVM baseline. Most contracts deploy unchanged, but several runtime behaviors diverge from Ethereum: USDC uses 18 decimals natively (not 6), the system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` logs all USDC Transfer events, the mempool enforces a 20 Gwei `maxFeePerGas` floor, blocklist reverts consume gas without a receipt, and `address(0)` sends revert rather than succeed. https://docs.arc.io/arc/references/evm-differences.md is the canonical reference for all Arc-specific runtime behaviors. Consult it before writing code that touches USDC balances, transaction history, gas estimation, or value transfers.
> Sub-second finality. Transactions are final in under 1 second. No need to wait for multiple block confirmations.
> Use App Kits for multichain payment and liquidity capabilities. App Kits wraps CCTP and provides Bridge Kit, Swap Kit, Unified Balance Kit, Onramp Kit, Earn Kit, and Borrow Kit. Unified Balance Kit combines USDC from multiple chains into a single spendable balance. Earn Kit integrates earn opportunities into your app. Borrow Kit lets users borrow USDC against cirBTC collateral on Arc.
> Use Arc Foundry for contract development. Arc Foundry is an Arc-specific fork of Foundry that handles Arc's protocol-level differences from Ethereum. It provides arc-forge, arc-cast, and arc-anvil. Install it before deploying contracts: https://docs.arc.io/arc/tutorials/install-arc-foundry.md.
> Arc is available on both Testnet and Mainnet. See https://docs.arc.io/arc/references/connect-to-arc.md for RPC endpoints and https://faucet.circle.com for testnet tokens.
> Always check Contract Addresses: https://docs.arc.io/arc/references/contract-addresses.md
> Building beyond Arc? Circle offers skills for the full platform: use-usdc (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-usdc/SKILL.md), use-circle-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-circle-wallets/SKILL.md), use-developer-controlled-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-developer-controlled-wallets/SKILL.md), use-user-controlled-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-user-controlled-wallets/SKILL.md), use-modular-wallets (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-modular-wallets/SKILL.md), use-gateway (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-gateway/SKILL.md), use-smart-contract-platform (https://github.com/circlefin/skills/blob/master/plugins/circle/skills/use-smart-contract-platform/SKILL.md). Full Circle developer docs: https://developers.circle.com/llms.txt.

# Connect to Arc

> Set up your wallet and configure your development environment for Arc.

export const ConnectWallet = ({network = "testnet"} = {}) => {
  const isMainnet = network === "mainnet";
  const networkLabel = isMainnet ? "Arc" : "Arc Testnet";
  const targetChainId = bus => isMainnet ? bus.ARC_MAINNET_CHAIN_ID : bus.ARC_TESTNET_CHAIN_ID;
  const walletIcon = <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cw-icon shrink-0" aria-hidden="true">
      <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 1 0 0 4h3a1 1 0 0 0 1-1v-2.5" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>;
  const truncateAddress = addr => {
    if (!addr) return "";
    return addr.slice(0, 6) + "…" + addr.slice(-4);
  };
  const canUseDOM = typeof window !== "undefined";
  const [status, setStatus] = useState("checking");
  const [walletState, setWalletState] = useState(null);
  const [walletsCount, setWalletsCount] = useState(0);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("idle");
  const [wallets, setWallets] = useState([]);
  useEffect(() => {
    if (!canUseDOM) {
      setStatus("not-installed");
      return;
    }
    const bus = window.__arcWallet;
    const syncFromBus = () => {
      const b = window.__arcWallet;
      if (!b) return;
      setWalletState(b.state);
      setWalletsCount(b.wallets.length);
      setWallets(b.wallets);
      if (b.state) {
        setStatus("connected");
      } else if (b.isReady) {
        if (b.wallets.length === 0 && !window.ethereum) {
          setStatus("not-installed");
        } else {
          setStatus("disconnected");
        }
      }
    };
    const handleChanged = () => syncFromBus();
    const handleWalletsChanged = () => syncFromBus();
    const handleReady = () => syncFromBus();
    window.addEventListener("arc:wallet:changed", handleChanged);
    window.addEventListener("arc:wallet:wallets-changed", handleWalletsChanged);
    window.addEventListener("arc:wallet:ready", handleReady);
    if (bus) syncFromBus();
    return () => {
      window.removeEventListener("arc:wallet:changed", handleChanged);
      window.removeEventListener("arc:wallet:wallets-changed", handleWalletsChanged);
      window.removeEventListener("arc:wallet:ready", handleReady);
    };
  }, []);
  const handleConnect = async () => {
    if (!window.__arcWallet) return;
    setError(null);
    setBusy(true);
    try {
      await window.__arcWallet.connect();
      try {
        await window.__arcWallet.switchChain(targetChainId(window.__arcWallet));
      } catch (switchErr) {
        if (switchErr && switchErr.code !== 4001) {
          throw switchErr;
        }
      }
    } catch (err) {
      if (err && err.code === "MULTIPLE_WALLETS") {
        setStep("picking");
      } else if (err && err.code === 4001) {
        setError("Request rejected. Try again when ready.");
      } else if (err && (/No wallet detected/i).test(err.message || "")) {
        setError("No wallet found. Install a browser wallet to continue.");
      } else if (err && (/User cancelled/i).test(err.message || "")) {} else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  const handlePickWallet = async uuid => {
    if (!window.__arcWallet) return;
    setError(null);
    setBusy(true);
    try {
      await window.__arcWallet.connect(uuid);
      try {
        await window.__arcWallet.switchChain(targetChainId(window.__arcWallet));
      } catch (switchErr) {
        if (switchErr && switchErr.code !== 4001) {
          throw switchErr;
        }
      }
      setStep("idle");
    } catch (err) {
      if (err && err.code === 4001) {
        setError("Request rejected. Try again when ready.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };
  const handleCancelPick = () => {
    setStep("idle");
    setError(null);
  };
  const handleDisconnect = async () => {
    if (!window.__arcWallet) return;
    setBusy(true);
    try {
      await window.__arcWallet.disconnect();
    } finally {
      setBusy(false);
    }
  };
  const handleCopy = async () => {
    if (!walletState || !walletState.address) return;
    try {
      await navigator.clipboard.writeText(walletState.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  if (status === "checking") {
    return null;
  }
  if (status === "not-installed") {
    return <div className="cw-card rounded-xl p-5 mb-4 not-prose">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {walletIcon}
            <p className="cw-text-body text-sm m-0">
              No wallet detected. Install a browser wallet to connect to{" "}
              {networkLabel}.
            </p>
          </div>
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="cw-btn-primary inline-block rounded-md px-4 py-2 text-sm font-medium no-underline whitespace-nowrap" aria-label="Download MetaMask (opens in new tab)">
            Get MetaMask →
          </a>
        </div>
      </div>;
  }
  if (status === "connected" && walletState) {
    return <div className="cw-card rounded-xl p-5 mb-4 not-prose">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="cw-badge-connected inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{
      background: "currentColor"
    }} />
              Connected
            </span>
            <span className="cw-text-subtle text-xs">
              {networkLabel}
              {walletState.connector ? ` · ${walletState.connector}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleCopy} className="cw-text-accent text-sm font-mono flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0" aria-label="Copy wallet address to clipboard" title={walletState.address}>
              {truncateAddress(walletState.address)}
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{
      display: copied ? "none" : "inline-block"
    }}>
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{
      display: copied ? "inline-block" : "none",
      color: "#8DD89F"
    }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button onClick={handleDisconnect} disabled={busy} className="cw-text-subtle text-xs bg-transparent border-0 cursor-pointer p-0 underline" aria-label="Disconnect wallet">
              Disconnect
            </button>
          </div>
        </div>
      </div>;
  }
  if (status === "disconnected" && step === "picking") {
    return <div className="cw-card rounded-xl p-5 mb-4 not-prose">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={handleCancelPick} disabled={busy} className="cw-text-subtle text-sm bg-transparent border-0 cursor-pointer p-0" aria-label="Back">
            ← Back
          </button>
          <strong className="cw-text-body text-sm">Choose a wallet</strong>
        </div>
        <div className="flex flex-col gap-1.5">
          {wallets.map(w => <button key={w.info.uuid} onClick={() => handlePickWallet(w.info.uuid)} disabled={busy} className="flex items-center gap-3 p-3 rounded-md bg-transparent border-0 cursor-pointer text-left cw-text-body cw-picker-row" aria-label={`Connect with ${w.info.name}`}>
              {w.info.icon && <img src={w.info.icon} alt="" width={28} height={28} aria-hidden="true" style={{
      borderRadius: 6
    }} />}
              <span className="text-sm">{w.info.name}</span>
            </button>)}
        </div>
        {error && <p className="cw-error text-xs mt-2 mb-0" role="alert">{error}</p>}
      </div>;
  }
  const buttonText = busy ? "Connecting…" : "Connect Wallet";
  return <div className="cw-card rounded-xl p-5 mb-4 not-prose">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {walletIcon}
          <p className="cw-text-body text-sm m-0">
            Adds the network configuration and connects your account.
          </p>
        </div>
        <button onClick={handleConnect} disabled={busy} className="cw-btn-primary rounded-md px-4 py-2 text-sm font-medium border-0 cursor-pointer whitespace-nowrap shrink-0" aria-label={`Connect wallet to ${networkLabel}`} aria-busy={busy}>
          {buttonText}
        </button>
      </div>
      {error && <p className="cw-error text-xs mt-2 mb-0" role="alert">
          {error}
        </p>}
    </div>;
};

Connect a wallet to Arc using one-click setup or manual configuration.

<Tabs>
  <Tab title="Mainnet">
    ## Wallet setup

    Use the following button to add Arc Mainnet to your wallet automatically.

    <ConnectWallet network="mainnet" />

    ### Manual setup

    <Tip>
      Arc uses USDC as the native gas token (18 decimals). If your wallet supports
      **custom gas tokens**, ensure display/decimals are set correctly. Wallets that
      don't support custom gas tokens still work for signing and sending
      transactions; balances may display as "ETH" but the underlying token is USDC.
      See [Gas and fees](/arc/references/gas-and-fees) for details.
    </Tip>

    <Tabs>
      <Tab title="MetaMask">
        <Steps>
          <Step title="Open network settings">
            Open MetaMask → **Settings** → **Networks** → **Add network** → **Add a network manually**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc |
            | **New RPC URL** | `https://rpc.mainnet.arc.io` |
            | **Chain ID** | 5042 |
            | **Currency symbol** | USDC |
            | **Explorer URL** | `https://explorer.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Rabby">
        <Steps>
          <Step title="Open network settings">
            Open Rabby → click the **network selector** (top-left) → **Add Custom Network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Chain Name** | Arc |
            | **Chain ID** | 5042 |
            | **RPC URL** | `https://rpc.mainnet.arc.io` |
            | **Currency** | USDC |
            | **Block Explorer** | `https://explorer.arc.io` |
          </Step>

          <Step title="Confirm and switch">
            Click **Confirm**, then select Arc from the network list.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Coinbase Wallet">
        <Steps>
          <Step title="Open network settings">
            Open Coinbase Wallet → **Settings** → **Networks** → **Add custom network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc |
            | **RPC URL** | `https://rpc.mainnet.arc.io` |
            | **Chain ID** | 5042 |
            | **Currency symbol** | USDC |
            | **Block explorer** | `https://explorer.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Rainbow">
        <Steps>
          <Step title="Open network settings">
            Open Rainbow → **Settings** (gear icon) → **Networks** → **Custom Network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc |
            | **RPC URL** | `https://rpc.mainnet.arc.io` |
            | **Chain ID** | 5042 |
            | **Symbol** | USDC |
            | **Block explorer** | `https://explorer.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc.
          </Step>
        </Steps>
      </Tab>
    </Tabs>

    ## Network details

    | Parameter | Value |
    | :- | :- |
    | Chain ID | `5042` |
    | Currency | USDC |
    | Explorer | [explorer.arc.io](https://explorer.arc.io) |

    ### RPC endpoints

    <CodeGroup>
      ```text Primary theme={null}
      https://rpc.mainnet.arc.io
      ```

      ```text Alchemy theme={null}
      https://arc-mainnet.g.alchemy.com/v2/YOUR_API_KEY
      ```

      ```text Blockdaemon theme={null}
      https://rpc.blockdaemon.mainnet.arc.io
      ```

      ```text dRPC theme={null}
      https://rpc.drpc.mainnet.arc.io
      ```

      ```text QuickNode theme={null}
      https://rpc.quicknode.mainnet.arc.io
      ```
    </CodeGroup>

    ### WebSocket endpoints

    <CodeGroup>
      ```text Alchemy theme={null}
      wss://arc-mainnet.g.alchemy.com/v2/YOUR_API_KEY
      ```

      ```text Blockdaemon theme={null}
      wss://rpc.blockdaemon.mainnet.arc.io/websocket
      ```

      ```text QuickNode theme={null}
      wss://rpc.quicknode.mainnet.arc.io
      ```
    </CodeGroup>
  </Tab>

  <Tab title="Testnet">
    ## Wallet setup

    Use the following button to add Arc Testnet to your wallet automatically.

    <ConnectWallet />

    ### Manual setup

    <Tip>
      Arc uses USDC as the native gas token (18 decimals). If your wallet supports
      **custom gas tokens**, ensure display/decimals are set correctly. Wallets that
      don't support custom gas tokens still work for signing and sending
      transactions; balances may display as "ETH" but the underlying token is USDC.
      See [Gas and fees](/arc/references/gas-and-fees) for details.
    </Tip>

    <Tabs>
      <Tab title="MetaMask">
        <Steps>
          <Step title="Open network settings">
            Open MetaMask → **Settings** → **Networks** → **Add network** → **Add a network manually**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc Testnet |
            | **New RPC URL** | `https://rpc.testnet.arc.io` |
            | **Chain ID** | 5042002 |
            | **Currency symbol** | USDC |
            | **Explorer URL** | `https://explorer.testnet.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc Testnet.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Rabby">
        <Steps>
          <Step title="Open network settings">
            Open Rabby → click the **network selector** (top-left) → **Add Custom Network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Chain Name** | Arc Testnet |
            | **Chain ID** | 5042002 |
            | **RPC URL** | `https://rpc.testnet.arc.io` |
            | **Currency** | USDC |
            | **Block Explorer** | `https://explorer.testnet.arc.io` |
          </Step>

          <Step title="Confirm and switch">
            Click **Confirm**, then select Arc Testnet from the network list.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Coinbase Wallet">
        <Steps>
          <Step title="Open network settings">
            Open Coinbase Wallet → **Settings** → **Networks** → **Add custom network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc Testnet |
            | **RPC URL** | `https://rpc.testnet.arc.io` |
            | **Chain ID** | 5042002 |
            | **Currency symbol** | USDC |
            | **Block explorer** | `https://explorer.testnet.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc Testnet.
          </Step>
        </Steps>
      </Tab>

      <Tab title="Rainbow">
        <Steps>
          <Step title="Open network settings">
            Open Rainbow → **Settings** (gear icon) → **Networks** → **Custom Network**.
          </Step>

          <Step title="Enter network details">
            | Field | Value |
            | :- | :- |
            | **Network name** | Arc Testnet |
            | **RPC URL** | `https://rpc.testnet.arc.io` |
            | **Chain ID** | 5042002 |
            | **Symbol** | USDC |
            | **Block explorer** | `https://explorer.testnet.arc.io` |
          </Step>

          <Step title="Save and switch">
            Click **Save**, then switch to Arc Testnet.
          </Step>
        </Steps>
      </Tab>
    </Tabs>

    ## Network details

    | Parameter | Value |
    | :- | :- |
    | Chain ID | `5042002` |
    | Currency | USDC |
    | Explorer | [explorer.testnet.arc.io](https://explorer.testnet.arc.io) |
    | Faucet | [faucet.circle.com](https://faucet.circle.com) |

    ### RPC endpoints

    <CodeGroup>
      ```text Primary theme={null}
      https://rpc.testnet.arc.io
      ```

      ```text Blockdaemon theme={null}
      https://rpc.blockdaemon.testnet.arc.io
      ```

      ```text dRPC theme={null}
      https://rpc.drpc.testnet.arc.io
      ```

      ```text QuickNode theme={null}
      https://rpc.quicknode.testnet.arc.io
      ```
    </CodeGroup>

    ### WebSocket endpoints

    <CodeGroup>
      ```text Primary theme={null}
      wss://rpc.testnet.arc.io
      ```

      ```text Blockdaemon theme={null}
      wss://rpc.blockdaemon.testnet.arc.io:443/websocket
      ```

      ```text dRPC theme={null}
      wss://rpc.drpc.testnet.arc.io
      ```

      ```text QuickNode theme={null}
      wss://rpc.quicknode.testnet.arc.io
      ```
    </CodeGroup>
  </Tab>
</Tabs>

## Frontend wallet libraries

Use `wagmi` and `viem` to integrate Arc into
[ConnectKit](https://family.co/docs/connectkit),
[Reown AppKit](https://docs.reown.com/appkit/overview), or a bare
[WalletConnect](https://docs.walletconnect.com) connector.

<Warning>
  Don't display native USDC and ERC-20 USDC as separate balance rows. They're
  the same balance; always show a single USDC balance.
</Warning>

### Chain definition

&#x20;

<Tabs>
  <Tab title="Mainnet">
    `viem` ships Arc Mainnet as a built-in chain. No manual definition is needed.

    ```typescript theme={null}
    import { arc } from "viem/chains";
    ```
  </Tab>

  <Tab title="Testnet">
    `viem` ships Arc Testnet as a built-in chain. No manual definition is needed.

    ```typescript theme={null}
    import { arcTestnet } from "viem/chains";
    ```
  </Tab>
</Tabs>

### Configure wallet connection

Pick the tab that matches your setup.

&#x20;

<Tabs>
  <Tab title="ConnectKit">
    ```bash theme={null}
    npm install connectkit wagmi viem
    ```

    ```typescript theme={null}
    import { arc, arcTestnet, mainnet } from "viem/chains";
    import { createConfig, http } from "wagmi";
    import { getDefaultConfig } from "connectkit";

    const config = createConfig(
      getDefaultConfig({
        chains: [arc, arcTestnet, mainnet],
        transports: {
          [arc.id]: http("https://rpc.mainnet.arc.io"),
          [arcTestnet.id]: http("https://rpc.testnet.arc.io"),
          [mainnet.id]: http("https://cloudflare-eth.com"),
        },
        walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
        appName: "Your App Name",
      }),
    );
    ```

    <Warning>
      When `mainnet` is omitted from `chains`, ConnectKit falls back to its own
      `eth.merkle.io` endpoint for ENS name lookups, which blocks cross-origin
      browser requests. Include `mainnet` with a CORS-safe transport (such as the
      Cloudflare endpoint shown earlier) to prevent this.
    </Warning>
  </Tab>

  <Tab title="Reown AppKit">
    ```bash theme={null}
    npm install @reown/appkit @reown/appkit-adapter-wagmi wagmi viem @tanstack/react-query
    ```

    <Warning>
      Import `defineChain` from `@reown/appkit/networks`, not from `viem`. AppKit
      requires two additional fields (`caipNetworkId` and `chainNamespace`) that
      `viem`'s version omits; using the wrong import causes a runtime error.
    </Warning>

    ```typescript theme={null}
    import { defineChain } from "@reown/appkit/networks";
    import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
    import { createAppKit } from "@reown/appkit/react";

    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

    const arc = defineChain({
      id: 5042,
      caipNetworkId: "eip155:5042",
      chainNamespace: "eip155",
      name: "Arc",
      nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
      rpcUrls: {
        default: {
          http: ["https://rpc.mainnet.arc.io"],
          webSocket: ["wss://rpc.quicknode.mainnet.arc.io"],
        },
      },
      blockExplorers: {
        default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
      },
    });

    const arcTestnet = defineChain({
      id: 5042002,
      caipNetworkId: "eip155:5042002",
      chainNamespace: "eip155",
      name: "Arc Testnet",
      nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
      rpcUrls: {
        default: {
          http: ["https://rpc.testnet.arc.io"],
          webSocket: ["wss://rpc.testnet.arc.io"],
        },
      },
      blockExplorers: {
        default: { name: "Block Explorer", url: "https://explorer.testnet.arc.io" },
      },
      testnet: true,
    });

    const wagmiAdapter = new WagmiAdapter({
      networks: [arc, arcTestnet],
      projectId,
    });

    createAppKit({
      adapters: [wagmiAdapter],
      networks: [arc, arcTestnet],
      projectId,
      metadata: {
        name: "Your App Name",
        description: "Your App Description",
        url: "https://yourdomain.com",
        icons: ["https://yourdomain.com/icon.png"],
      },
    });
    ```

    <Note>
      Get a project ID at [dashboard.reown.com](https://dashboard.reown.com). The
      same project ID works for the bare WalletConnect connector.
    </Note>
  </Tab>

  <Tab title="WalletConnect">
    For `wagmi` apps that need WalletConnect sessions without Reown AppKit's full modal UI.

    ```typescript theme={null}
    import { arc, arcTestnet } from "viem/chains";
    import { createConfig, http } from "wagmi";
    import { walletConnect } from "wagmi/connectors";

    const config = createConfig({
      chains: [arc, arcTestnet],
      connectors: [
        walletConnect({
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
          metadata: {
            name: "Your App",
            description: "Your App Description",
            url: "https://yourdomain.com",
            icons: ["https://yourdomain.com/icon.png"],
          },
        }),
      ],
      transports: {
        [arc.id]: http("https://rpc.mainnet.arc.io"),
        [arcTestnet.id]: http("https://rpc.testnet.arc.io"),
      },
    });
    ```

    <Note>
      Arc Testnet (chain ID 5042002) is not registered in the WalletConnect chain
      registry. On first connection, WalletConnect issues a
      `wallet_addEthereumChain` call per user.
    </Note>
  </Tab>
</Tabs>
