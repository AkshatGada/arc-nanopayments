import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  pad,
  zeroAddress,
  maxUint256,
  type Address,
  type Hex,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
  defineChain,
  erc20Abi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import * as chains from 'viem/chains';
import { randomBytes } from 'crypto';
import { BatchEvmScheme } from './BatchEvmScheme';
import type { BatchEvmSigner } from '../types';
import type {
  BeforePaymentCreationHook,
  AfterPaymentCreationHook,
  OnPaymentCreationFailureHook,
  OnPaymentResponseHook,
  PaymentResponseContext,
} from '../hooks';

// Arc chains: prefer viem's chain export (added in viem ~2.52), fall back to a
// local definition for consumers pinned to older viem versions. viem's `arc`
// export still ships an empty RPC list, so CHAIN_CONFIGS.arc.rpcUrl (and this
// fallback) supply Circle's public mainnet RPC.
const ARC_MAINNET_RPC_URL = 'https://rpc.mainnet.arc.io';

const arcMainnet =
  (chains as Record<string, Chain>).arc ??
  defineChain({
    id: 5042,
    name: 'Arc',
    nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
    rpcUrls: {
      default: { http: [ARC_MAINNET_RPC_URL] },
    },
  });

const arcTestnetChain =
  chains.arcTestnet ??
  defineChain({
    id: 5042002,
    name: 'Arc Testnet',
    nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
    rpcUrls: {
      default: { http: ['https://rpc.testnet.arc.network'] },
    },
    testnet: true,
  });

// viem's sonicTestnet uses the old testnet.  This uses the new one.
const sonicTestnet = defineChain({
  id: 14601,
  name: 'Sonic Testnet',
  nativeCurrency: { decimals: 18, name: 'Sonic', symbol: 'S' },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.soniclabs.com'] },
  },
  blockExplorers: {
    default: { name: 'Sonic Testnet Explorer', url: 'https://testnet.soniclabs.com/' },
  },
  testnet: true,
});

// ============================================================================
// CONTRACT ABIS
// ============================================================================

// Gateway API URL
const GATEWAY_API_TESTNET = 'https://gateway-api-testnet.circle.com/v1';
const GATEWAY_API_MAINNET = 'https://gateway-api.circle.com/v1';

const GATEWAY_MINTER_ABI = [
  {
    name: 'gatewayMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestationPayload', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

const GATEWAY_WALLET_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'depositFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'totalBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'availableBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawingBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawableBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawalDelay',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawalBlock',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'depositor', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'initiateWithdrawal',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const;

// ============================================================================
// CHAIN CONFIGURATIONS
// ============================================================================

/**
 * Gateway domain identifiers for supported chains.
 * See: https://developers.circle.com/gateway/gateway-supported-blockchains
 */
export const GATEWAY_DOMAINS = {
  // Testnet
  arbitrumSepolia: 3,
  arcTestnet: 26,
  avalancheFuji: 1,
  baseSepolia: 6,
  sepolia: 0,
  hyperEvmTestnet: 19,
  optimismSepolia: 2,
  polygonAmoy: 7,
  seiAtlantic: 16,
  sonicTestnet: 13,
  unichainSepolia: 10,
  worldChainSepolia: 14,
  // Mainnet
  arbitrum: 3,
  avalanche: 1,
  base: 6,
  ethereum: 0,
  hyperEvm: 19,
  optimism: 2,
  polygon: 7,
  sei: 16,
  sonic: 13,
  unichain: 10,
  worldChain: 14,
  arc: 26,
} as const;

/**
 * Supported chain names type.
 */
export type SupportedChainName = keyof typeof GATEWAY_DOMAINS;

/**
 * Chain configuration with contract addresses.
 */
export interface ChainConfig {
  chain: Chain;
  domain: number;
  usdc: Address;
  gatewayWallet: Address;
  gatewayMinter: Address;
  rpcUrl?: string;
}

// Testnet GatewayWallet and GatewayMinter addresses (same across all testnet chains)
const TESTNET_GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as Address;
const TESTNET_GATEWAY_MINTER = '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as Address;

// Mainnet GatewayWallet and GatewayMinter addresses (same across all mainnet chains)
const MAINNET_GATEWAY_WALLET = '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as Address;
const MAINNET_GATEWAY_MINTER = '0x2222222d7164433c4C09B0b0D809a9b52C04C205' as Address;

/**
 * Chain configurations for supported chains.
 */
export const CHAIN_CONFIGS: Record<SupportedChainName, ChainConfig> = {
  // Testnet chains
  arbitrumSepolia: {
    chain: chains.arbitrumSepolia,
    domain: GATEWAY_DOMAINS.arbitrumSepolia,
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  arcTestnet: {
    chain: arcTestnetChain,
    domain: GATEWAY_DOMAINS.arcTestnet,
    usdc: '0x3600000000000000000000000000000000000000' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
    rpcUrl: 'https://rpc.testnet.arc.network',
  },
  avalancheFuji: {
    chain: chains.avalancheFuji,
    domain: GATEWAY_DOMAINS.avalancheFuji,
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  baseSepolia: {
    chain: chains.baseSepolia,
    domain: GATEWAY_DOMAINS.baseSepolia,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
    rpcUrl: 'https://sepolia-preconf.base.org',
  },
  sepolia: {
    chain: chains.sepolia,
    domain: GATEWAY_DOMAINS.sepolia,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  hyperEvmTestnet: {
    chain: chains.hyperliquidEvmTestnet,
    domain: GATEWAY_DOMAINS.hyperEvmTestnet,
    usdc: '0x2B3370eE501B4a559b57D449569354196457D8Ab' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  optimismSepolia: {
    chain: chains.optimismSepolia,
    domain: GATEWAY_DOMAINS.optimismSepolia,
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  polygonAmoy: {
    chain: chains.polygonAmoy,
    domain: GATEWAY_DOMAINS.polygonAmoy,
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  seiAtlantic: {
    chain: chains.seiTestnet,
    domain: GATEWAY_DOMAINS.seiAtlantic,
    usdc: '0x4fCF1784B31630811181f670Aea7A7bEF803eaED' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  sonicTestnet: {
    chain: sonicTestnet,
    domain: GATEWAY_DOMAINS.sonicTestnet,
    usdc: '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  unichainSepolia: {
    chain: chains.unichainSepolia,
    domain: GATEWAY_DOMAINS.unichainSepolia,
    usdc: '0x31d0220469e10c4E71834a79b1f276d740d3768F' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  worldChainSepolia: {
    chain: chains.worldchainSepolia,
    domain: GATEWAY_DOMAINS.worldChainSepolia,
    usdc: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88' as Address,
    gatewayWallet: TESTNET_GATEWAY_WALLET,
    gatewayMinter: TESTNET_GATEWAY_MINTER,
  },
  // Mainnet chains
  arbitrum: {
    chain: chains.arbitrum,
    domain: GATEWAY_DOMAINS.arbitrum,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  avalanche: {
    chain: chains.avalanche,
    domain: GATEWAY_DOMAINS.avalanche,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  base: {
    chain: chains.base,
    domain: GATEWAY_DOMAINS.base,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  ethereum: {
    chain: chains.mainnet,
    domain: GATEWAY_DOMAINS.ethereum,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
    rpcUrl: 'https://ethereum-rpc.publicnode.com',
  },
  hyperEvm: {
    chain: chains.hyperEvm,
    domain: GATEWAY_DOMAINS.hyperEvm,
    usdc: '0xb88339CB7199b77E23DB6E890353E22632Ba630f' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  optimism: {
    chain: chains.optimism,
    domain: GATEWAY_DOMAINS.optimism,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  polygon: {
    chain: chains.polygon,
    domain: GATEWAY_DOMAINS.polygon,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
    rpcUrl: 'https://poly.api.pocket.network',
  },
  sei: {
    chain: chains.sei,
    domain: GATEWAY_DOMAINS.sei,
    usdc: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
    rpcUrl: 'https://sei.api.pocket.network',
  },
  sonic: {
    chain: chains.sonic,
    domain: GATEWAY_DOMAINS.sonic,
    usdc: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  unichain: {
    chain: chains.unichain,
    domain: GATEWAY_DOMAINS.unichain,
    usdc: '0x078D782b760474a361dDA0AF3839290b0EF57AD6' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  worldChain: {
    chain: chains.worldchain,
    domain: GATEWAY_DOMAINS.worldChain,
    usdc: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
  },
  arc: {
    chain: arcMainnet,
    domain: GATEWAY_DOMAINS.arc,
    usdc: '0x3600000000000000000000000000000000000000' as Address,
    gatewayWallet: MAINNET_GATEWAY_WALLET,
    gatewayMinter: MAINNET_GATEWAY_MINTER,
    rpcUrl: ARC_MAINNET_RPC_URL,
  },
};

// ============================================================================
// GATEWAY CLIENT TYPES
// ============================================================================

/**
 * Configuration for creating a GatewayClient.
 */
export interface GatewayClientConfig {
  /** The chain to connect to */
  chain: SupportedChainName;
  /** Private key for signing transactions */
  privateKey: Hex;
  /**
   * Custom RPC URL. Optional for all chains (a public default is used).
   */
  rpcUrl?: string;
  /** Additional headers merged into every outbound Gateway API request. */
  headers?: Record<string, string>;
}

/**
 * Result of a deposit operation.
 */
export interface DepositResult {
  /** Transaction hash of the approval (if needed) */
  approvalTxHash?: Hex;
  /** Transaction hash of the deposit */
  depositTxHash: Hex;
  /** Amount deposited in USDC atomic units */
  amount: bigint;
  /** Formatted amount deposited */
  formattedAmount: string;
  /** Depositor address */
  depositor: Address;
}

/**
 * Result of a withdraw operation (instant transfer).
 */
export interface WithdrawResult {
  /** Transaction hash of the mint on destination chain */
  mintTxHash: Hex;
  /** Amount withdrawn in USDC atomic units */
  amount: bigint;
  /** Formatted amount withdrawn */
  formattedAmount: string;
  /** Source chain name */
  sourceChain: string;
  /** Destination chain name */
  destinationChain: string;
  /** Recipient address */
  recipient: Address;
}

/**
 * Result of a pay operation.
 */
export interface PayResult<T = unknown> {
  /** The response data from the resource */
  data: T;
  /** Amount paid in USDC atomic units */
  amount: bigint;
  /** Formatted amount paid */
  formattedAmount: string;
  /** Transaction hash from settlement */
  transaction: string;
  /** HTTP status code */
  status: number;
}

/**
 * All balances in one object.
 */
export interface Balances {
  /** Regular wallet USDC balance */
  wallet: {
    balance: bigint;
    formatted: string;
  };
  /** Gateway balances */
  gateway: {
    total: bigint;
    available: bigint;
    withdrawing: bigint;
    withdrawable: bigint;
    formattedTotal: string;
    formattedAvailable: string;
    formattedWithdrawing: string;
    formattedWithdrawable: string;
  };
}

/**
 * Result of checking if a URL supports batching.
 */
export interface SupportsResult {
  /** Whether the URL supports Gateway batching */
  supported: boolean;
  /** Payment requirements if supported */
  requirements?: Record<string, unknown>;
  /** Error message if not supported */
  error?: string;
}

/**
 * Result of a trustless withdrawal initiation.
 *
 * NOTE: Trustless withdrawals are for emergency use only when Circle's API is unavailable.
 * For normal withdrawals, use `transfer()` with the same source and destination chain.
 */
export interface TrustlessWithdrawalInitResult {
  /** Transaction hash */
  txHash: Hex;
  /** Amount being withdrawn in USDC atomic units */
  amount: bigint;
  /** Formatted amount being withdrawn */
  formattedAmount: string;
  /** Block number at which withdrawal becomes available (~7 days) */
  withdrawalBlock: bigint;
}

/**
 * Result of a trustless withdrawal completion.
 *
 * NOTE: Trustless withdrawals are for emergency use only when Circle's API is unavailable.
 */
export interface TrustlessWithdrawalResult {
  /** Transaction hash */
  txHash: Hex;
  /** Amount withdrawn in USDC atomic units */
  amount: bigint;
  /** Formatted amount withdrawn */
  formattedAmount: string;
}

/**
 * Gateway balance information.
 */
export interface GatewayBalance {
  /** Total balance in Gateway */
  total: bigint;
  /** Available balance (can be used) */
  available: bigint;
  /** Balance in withdrawal process */
  withdrawing: bigint;
  /** Balance ready to be withdrawn */
  withdrawable: bigint;
  /** Formatted total balance */
  formattedTotal: string;
  /** Formatted available balance */
  formattedAvailable: string;
  /** Formatted withdrawing balance */
  formattedWithdrawing: string;
  /** Formatted withdrawable balance */
  formattedWithdrawable: string;
}

// ============================================================================
// TRANSFER TYPES
// ============================================================================

export type TransferStatus =
  | 'received'
  | 'batched'
  | 'confirmed'
  | 'completed'
  | 'failed';

/**
 * Shape may evolve; preserve all fields as returned by the API.
 */
export interface TransferResponse {
  id: string;
  status: TransferStatus;
  token: 'USDC';
  sendingNetwork: string;
  recipientNetwork: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface SearchTransfersParams {
  from?: Hex;
  to?: Hex;
  nonce?: Hex;
  network?: string;
  status?: TransferStatus;
  token?: 'USDC';
  startDate?: string;
  endDate?: string;
  pageSize?: number;
  pageAfter?: string;
  pageBefore?: string;
}

export interface CursorPagination {
  self?: string;
  first?: string;
  prev?: string;
  next?: string;
  pageAfter?: string;
  pageBefore?: string;
}

export interface SearchTransfersResponse {
  transfers: TransferResponse[];
  pagination?: CursorPagination;
}

// ============================================================================
// GATEWAY CLIENT
// ============================================================================

/**
 * Gateway Client for gasless payments and cross-chain USDC via Circle Gateway.
 *
 * This client provides a simple interface for buyers to:
 * - **Deposit**: Move USDC into Gateway for gasless payments
 * - **Pay**: Pay for x402-protected resources (handles 402 automatically)
 * - **Withdraw**: Get USDC back (same-chain or cross-chain, instant)
 * - **GetBalances**: Check all balances in one call
 *
 * ## Typical Flow
 * ```typescript
 * const gateway = new GatewayClient({ chain: 'arcTestnet', privateKey });
 *
 * // 1. Deposit (one-time setup)
 * await gateway.deposit('100');
 *
 * // 2. Pay for resources (many times, gasless!)
 * const { data } = await gateway.pay('https://api.example.com/resource');
 *
 * // 3. Check balances
 * const balances = await gateway.getBalances();
 *
 * // 4. Withdraw when done
 * await gateway.withdraw('50');
 * // Or withdraw to a different chain (requires gas on destination)
 * await gateway.withdraw('25', { chain: 'baseSepolia' });
 * ```
 *
 * ## Emergency Flow (when Circle's API is down)
 * Use `initiateTrustlessWithdrawal()` and `completeTrustlessWithdrawal()` (7-day delay).
 */
export class GatewayClient {
  readonly chainConfig: ChainConfig;
  readonly account: ReturnType<typeof privateKeyToAccount>;
  readonly publicClient: PublicClient<Transport, Chain>;
  readonly walletClient: WalletClient<Transport, Chain, Account>;
  private readonly _headers: Record<string, string>;

  /**
   * The scheme that builds and signs the batched payment payload. `pay()`
   * delegates to this so the buyer flow runs the same lifecycle hooks as the
   * standalone `BatchEvmScheme` / `x402Client` paths.
   */
  private readonly batchScheme: BatchEvmScheme;

  /**
   * Creates a new GatewayClient.
   *
   * @param config - Configuration including chain and private key
   */
  constructor(config: GatewayClientConfig) {
    const chainConfig = CHAIN_CONFIGS[config.chain];
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${config.chain}`);
    }

    this.chainConfig = chainConfig;
    this._headers = config.headers ?? {};
    this.account = privateKeyToAccount(config.privateKey);

    const rpcUrl = config.rpcUrl ?? chainConfig.rpcUrl;
    const transport = rpcUrl ? http(rpcUrl) : http();

    this.publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport,
    }) as PublicClient<Transport, Chain>;

    this.walletClient = createWalletClient({
      account: this.account,
      chain: chainConfig.chain,
      transport,
    }) as WalletClient<Transport, Chain, Account>;

    // The viem account satisfies BatchEvmSigner (address + signTypedData).
    const signer: BatchEvmSigner = {
      address: this.account.address,
      signTypedData: (params) => this.account.signTypedData(params),
    };
    this.batchScheme = new BatchEvmScheme(signer);
  }

  // ============================================================================
  // PAYMENT LIFECYCLE HOOKS
  // ============================================================================
  //
  // These delegate to the underlying BatchEvmScheme so that the `pay()` buyer
  // flow runs the same lifecycle hooks as the standalone scheme / x402Client
  // paths — see https://docs.x402.org/advanced-concepts/lifecycle-hooks.

  /**
   * Register a hook that runs before the payment payload is created. Returning
   * `{ abort: true, reason }` causes `pay()` to throw before signing.
   */
  onBeforePaymentCreation(hook: BeforePaymentCreationHook): this {
    this.batchScheme.onBeforePaymentCreation(hook);
    return this;
  }

  /**
   * Register a hook that runs after the payment payload is successfully created.
   */
  onAfterPaymentCreation(hook: AfterPaymentCreationHook): this {
    this.batchScheme.onAfterPaymentCreation(hook);
    return this;
  }

  /**
   * Register a hook that runs when payload creation throws. Return
   * `{ recovered: true, payload }` to recover with the provided payload.
   */
  onPaymentCreationFailure(hook: OnPaymentCreationFailureHook): this {
    this.batchScheme.onPaymentCreationFailure(hook);
    return this;
  }

  /**
   * Register a hook that runs after the buyer's paid HTTP request completes.
   * Return `{ recovered: true }` to have `pay()` retry once with a fresh payload.
   */
  onPaymentResponse(hook: OnPaymentResponseHook): this {
    this.batchScheme.onPaymentResponse(hook);
    return this;
  }

  /**
   * Get the account address.
   */
  get address(): Address {
    return this.account.address;
  }

  /**
   * Get the chain name.
   */
  get chainName(): string {
    return this.chainConfig.chain.name;
  }

  /**
   * Get the Gateway domain for this chain.
   */
  get domain(): number {
    return this.chainConfig.domain;
  }

  /**
   * Get the chain name key for this client.
   */
  getChainName(): SupportedChainName {
    // Find the key in CHAIN_CONFIGS that matches our domain
    for (const [name, config] of Object.entries(CHAIN_CONFIGS)) {
      if (
        config.domain === this.chainConfig.domain &&
        config.chain.id === this.chainConfig.chain.id
      ) {
        return name as SupportedChainName;
      }
    }
    throw new Error('Unknown chain configuration');
  }

  /**
   * Get the USDC balance of the account (not in Gateway).
   *
   * @param address - Optional address to check (defaults to account address)
   * @returns USDC balance in atomic units and formatted
   */
  async getUsdcBalance(
    address?: Address,
  ): Promise<{ balance: bigint; formatted: string }> {
    const target = address ?? this.account.address;
    const balance = await this.publicClient.readContract({
      address: this.chainConfig.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [target],
    });

    return {
      balance,
      formatted: formatUnits(balance, 6),
    };
  }

  /**
   * Get all balances (wallet + gateway) in one call.
   *
   * @param address - Optional address to check (defaults to account address)
   * @returns All balances
   */
  async getBalances(address?: Address): Promise<Balances> {
    const target = address ?? this.account.address;

    const [wallet, gateway] = await Promise.all([
      this.getUsdcBalance(target),
      this.getGatewayBalance(target),
    ]);

    return {
      wallet,
      gateway,
    };
  }

  /**
   * Get the Gateway balance for an address.
   *
   * @param address - Optional address to check (defaults to account address)
   * @returns Gateway balance information
   * @deprecated Use `getBalances()` instead for a unified view
   */
  async getBalance(address?: Address): Promise<GatewayBalance> {
    return this.getGatewayBalance(address);
  }

  /**
   * Get the Gateway balance for an address via Gateway API.
   */
  private async getGatewayBalance(address?: Address): Promise<GatewayBalance> {
    const target = address ?? this.account.address;
    const apiBaseUrl = this.isTestnet() ? GATEWAY_API_TESTNET : GATEWAY_API_MAINNET;

    const response = await fetch(`${apiBaseUrl}/balances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.gatewayApiHeaders(),
      },
      body: JSON.stringify({
        token: 'USDC',
        sources: [{ depositor: target, domain: this.chainConfig.domain }],
      }),
    });

    const data = (await response.json()) as {
      balances?: Array<{
        balance: string;
        withdrawing?: string;
        withdrawable?: string;
      }>;
      message?: string;
    };

    if (!response.ok) {
      throw new Error(
        `Gateway API balance fetch failed: ${data.message ?? response.statusText}`,
      );
    }

    if (!data.balances || data.balances.length === 0) {
      throw new Error('Gateway API returned no balances for the depositor.');
    }

    const balanceData = data.balances[0];
    // Gateway API returns formatted decimal strings (e.g. "0.300000") for USDC.
    // Convert to atomic units (6 decimals) for bigint fields.
    const available = parseUnits(balanceData.balance, 6);
    const withdrawing = parseUnits(balanceData.withdrawing ?? '0', 6);
    const withdrawable = parseUnits(balanceData.withdrawable ?? '0', 6);
    const total = available + withdrawing;

    return {
      total,
      available,
      withdrawing,
      withdrawable,
      formattedTotal: formatUnits(total, 6),
      formattedAvailable: formatUnits(available, 6),
      formattedWithdrawing: formatUnits(withdrawing, 6),
      formattedWithdrawable: formatUnits(withdrawable, 6),
    };
  }

  /**
   * Deposit USDC into the Gateway Wallet.
   *
   * This method first approves the Gateway Wallet contract to spend USDC,
   * then deposits the specified amount.
   *
   * @param amount - Amount of USDC to deposit (as a decimal string, e.g., "10.5")
   * @param options - Optional deposit options
   * @returns Deposit result with transaction hashes
   */
  async deposit(
    amount: string,
    options?: {
      /** Amount to approve (defaults to amount) */
      approveAmount?: string;
      /** Skip approval if already approved */
      skipApprovalCheck?: boolean;
    },
  ): Promise<DepositResult> {
    const depositAmount = parseUnits(amount, 6);
    const approveAmount = parseUnits(options?.approveAmount ?? amount, 6);

    // Check balance
    const { balance } = await this.getUsdcBalance();
    if (balance < depositAmount) {
      throw new Error(
        `Insufficient USDC balance. Have: ${formatUnits(balance, 6)}, Need: ${amount}`,
      );
    }

    let approvalTxHash: Hex | undefined;

    // Check current allowance unless skipped
    if (!options?.skipApprovalCheck) {
      const allowance = await this.publicClient.readContract({
        address: this.chainConfig.usdc,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [this.account.address, this.chainConfig.gatewayWallet],
      });

      if (allowance < depositAmount) {
        // Approve the Gateway Wallet
        approvalTxHash = await this.walletClient.writeContract({
          address: this.chainConfig.usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [this.chainConfig.gatewayWallet, approveAmount],
        });

        try {
          await this.publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
        } catch (err) {
          throw new Error(`Approval transaction failed: ${approvalTxHash}`, {
            cause: err,
          });
        }
      }
    }

    // Deposit into Gateway Wallet
    const depositTxHash = await this.walletClient.writeContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'deposit',
      args: [this.chainConfig.usdc, depositAmount],
      gas: 120000n,
    });

    try {
      await this.publicClient.waitForTransactionReceipt({ hash: depositTxHash });
    } catch (err) {
      throw new Error(`Deposit transaction failed: ${depositTxHash}`, {
        cause: err,
      });
    }

    return {
      approvalTxHash,
      depositTxHash,
      amount: depositAmount,
      formattedAmount: amount,
      depositor: this.account.address,
    };
  }

  /**
   * Deposit USDC into the Gateway Wallet on behalf of another address.
   *
   * The resulting balance belongs to the specified depositor address,
   * not the caller.
   *
   * @param amount - Amount of USDC to deposit (as a decimal string)
   * @param depositor - Address that will own the resulting balance
   * @param options - Optional deposit options
   * @returns Deposit result with transaction hashes
   */
  async depositFor(
    amount: string,
    depositor: Address,
    options?: {
      /** Amount to approve (defaults to amount) */
      approveAmount?: string;
      /** Skip approval if already approved */
      skipApprovalCheck?: boolean;
    },
  ): Promise<DepositResult> {
    const depositAmount = parseUnits(amount, 6);
    const approveAmount = parseUnits(options?.approveAmount ?? amount, 6);

    // Check balance
    const { balance } = await this.getUsdcBalance();
    if (balance < depositAmount) {
      throw new Error(
        `Insufficient USDC balance. Have: ${formatUnits(balance, 6)}, Need: ${amount}`,
      );
    }

    let approvalTxHash: Hex | undefined;

    // Check current allowance unless skipped
    if (!options?.skipApprovalCheck) {
      const allowance = await this.publicClient.readContract({
        address: this.chainConfig.usdc,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [this.account.address, this.chainConfig.gatewayWallet],
      });

      if (allowance < depositAmount) {
        // Approve the Gateway Wallet
        approvalTxHash = await this.walletClient.writeContract({
          address: this.chainConfig.usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [this.chainConfig.gatewayWallet, approveAmount],
        });

        try {
          await this.publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
        } catch (err) {
          throw new Error(`Approval transaction failed: ${approvalTxHash}`, {
            cause: err,
          });
        }
      }
    }

    // Deposit into Gateway Wallet for another address
    const depositTxHash = await this.walletClient.writeContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'depositFor',
      args: [this.chainConfig.usdc, depositor, depositAmount],
      gas: 120000n,
    });

    try {
      await this.publicClient.waitForTransactionReceipt({ hash: depositTxHash });
    } catch (err) {
      throw new Error(`Deposit transaction failed: ${depositTxHash}`, {
        cause: err,
      });
    }

    return {
      approvalTxHash,
      depositTxHash,
      amount: depositAmount,
      formattedAmount: amount,
      depositor,
    };
  }

  // ============================================================================
  // PAYMENT (Pay for x402 resources)
  // ============================================================================

  /**
   * Check if a URL supports Gateway batching before paying.
   *
   * @param url - The URL to check
   * @returns Whether batching is supported and payment requirements
   */
  async supports(url: string): Promise<SupportsResult> {
    try {
      const response = await fetch(url);

      if (response.status !== 402) {
        return { supported: false, error: 'Resource does not require payment (not 402)' };
      }

      // x402 v2: Read from PAYMENT-REQUIRED header (base64-encoded)
      const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED');
      if (!paymentRequiredHeader) {
        return {
          supported: false,
          error: 'Missing PAYMENT-REQUIRED header in 402 response',
        };
      }
      const data: { accepts?: Array<Record<string, unknown>> } = JSON.parse(
        Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8'),
      );
      const accepts = data.accepts;

      if (!accepts || accepts.length === 0) {
        return { supported: false, error: 'No payment options in 402 response' };
      }

      // Find a batching option matching this client's chain
      const expectedNetwork = `eip155:${this.chainConfig.chain.id}`;
      const batchingOption = accepts.find((opt) => {
        const extra = opt.extra as Record<string, unknown> | undefined;
        return (
          opt.network === expectedNetwork &&
          extra?.name === 'GatewayWalletBatched' &&
          extra?.version === '1' &&
          typeof extra?.verifyingContract === 'string'
        );
      });

      if (!batchingOption) {
        return {
          supported: false,
          error: `No Gateway batching option available for network ${expectedNetwork} (${this.chainConfig.chain.name})`,
        };
      }

      return { supported: true, requirements: batchingOption };
    } catch (error) {
      return { supported: false, error: (error as Error).message };
    }
  }

  /**
   * Pay for an x402-protected resource.
   *
   * This method handles the full 402 payment flow automatically:
   * 1. Makes initial request
   * 2. If 402, finds Gateway batching option
   * 3. Signs payment authorization
   * 4. Retries with Payment-Signature header
   *
   * @param url - The URL to pay for
   * @param options - Optional request options
   * @returns The response data and payment info
   *
   * @example
   * ```typescript
   * const { data, amount } = await gateway.pay('https://api.example.com/resource');
   * console.log('Paid', amount, 'USDC for:', data);
   * ```
   */
  async pay<T = unknown>(
    url: string,
    options?: {
      /** HTTP method (default: GET) */
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      /** Request body for POST/PUT */
      body?: unknown;
      /** Additional headers */
      headers?: Record<string, string>;
    },
  ): Promise<PayResult<T>> {
    const method = options?.method ?? 'GET';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };
    const serializedBody =
      options?.body !== undefined
        ? typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body)
        : undefined;

    // Step 1: Make initial request
    const initialResponse = await fetch(url, {
      method,
      headers,
      body: serializedBody,
    });

    // If not 402, check if it's an error or success
    if (initialResponse.status !== 402) {
      if (initialResponse.ok) {
        const data = (await initialResponse.json()) as T;
        return {
          data,
          amount: 0n,
          formattedAmount: '0',
          transaction: '',
          status: initialResponse.status,
        };
      }
      throw new Error(`Request failed with status ${initialResponse.status}`);
    }

    // Step 2: Parse 402 response
    // x402 v2: Read from PAYMENT-REQUIRED header (base64-encoded)
    const paymentRequiredHeader = initialResponse.headers.get('PAYMENT-REQUIRED');
    if (!paymentRequiredHeader) {
      throw new Error('Missing PAYMENT-REQUIRED header in 402 response');
    }
    const paymentRequired = JSON.parse(
      Buffer.from(paymentRequiredHeader, 'base64').toString('utf-8'),
    ) as {
      x402Version?: number;
      accepts?: Array<Record<string, unknown>>;
      resource?: Record<string, unknown>;
    };
    const accepts = paymentRequired.accepts;

    if (!accepts || accepts.length === 0) {
      throw new Error('No payment options in 402 response');
    }

    // Step 3: Find Gateway batching option matching this client's chain
    const expectedNetwork = `eip155:${this.chainConfig.chain.id}`;
    const batchingOption = accepts.find((opt) => {
      const extra = opt.extra as Record<string, unknown> | undefined;
      return (
        opt.network === expectedNetwork &&
        extra?.name === 'GatewayWalletBatched' &&
        extra?.version === '1' &&
        typeof extra?.verifyingContract === 'string'
      );
    });

    if (!batchingOption) {
      throw new Error(
        `No Gateway batching option available for network ${expectedNetwork} (${this.chainConfig.chain.name}). The seller may not support this chain. Use supports() to check first.`,
      );
    }

    // Step 4: Create, sign, and send the payment. `createPaymentPayload`
    // (delegated to BatchEvmScheme) runs the onBefore/onAfter/onFailure payment
    // hooks; `dispatchPaymentResponse` runs the onPaymentResponse hooks and may
    // request a single retry with a fresh payload.
    const x402Version = paymentRequired.x402Version ?? 2;
    const amount = BigInt(batchingOption.amount as string);

    for (let attempt = 0; ; attempt++) {
      const paymentPayload = await this.batchScheme.createPaymentPayload(
        x402Version,
        batchingOption as unknown as Parameters<
          BatchEvmScheme['createPaymentPayload']
        >[1],
      );

      const paymentHeader = Buffer.from(
        JSON.stringify({
          ...paymentPayload,
          resource: paymentRequired.resource,
          accepted: batchingOption,
        }),
      ).toString('base64');

      const paidResponse = await fetch(url, {
        method,
        headers: {
          ...headers,
          'Payment-Signature': paymentHeader,
        },
        body: serializedBody,
      });

      // x402 v2: settlement info lives in the PAYMENT-RESPONSE header
      // (base64-encoded). Parse it once for both the response hook and result.
      let settleResponse: { transaction?: string } | undefined;
      const paymentResponseHeader = paidResponse.headers.get('PAYMENT-RESPONSE');
      if (paymentResponseHeader) {
        settleResponse = JSON.parse(
          Buffer.from(paymentResponseHeader, 'base64').toString('utf-8'),
        ) as { transaction?: string };
      }

      const responseContext: PaymentResponseContext = {
        paymentPayload: {
          x402Version: paymentPayload.x402Version,
          payload: paymentPayload.payload as unknown as Record<string, unknown>,
        },
        requirements: batchingOption as unknown as PaymentResponseContext['requirements'],
        paymentRequired:
          paymentRequired as unknown as PaymentResponseContext['paymentRequired'],
        settleResponse:
          settleResponse as unknown as PaymentResponseContext['settleResponse'],
        error: paidResponse.ok
          ? undefined
          : new Error(`Payment failed with status ${paidResponse.status}`),
      };

      const recovery = await this.batchScheme.dispatchPaymentResponse(responseContext);
      // Honor a single retry request from an onPaymentResponse hook.
      if (recovery?.recovered && attempt === 0) {
        continue;
      }

      if (!paidResponse.ok) {
        const error = await paidResponse.json().catch(() => ({}));
        throw new Error(
          `Payment failed: ${(error as { error?: string }).error || paidResponse.statusText}`,
        );
      }

      const data = (await paidResponse.json()) as T;

      return {
        data,
        amount,
        formattedAmount: formatUnits(amount, 6),
        transaction: settleResponse?.transaction ?? '',
        status: paidResponse.status,
      };
    }
  }

  // ============================================================================
  // WITHDRAW (Instant way to get USDC out)
  // ============================================================================

  /**
   * Withdraw USDC from Gateway to your wallet.
   *
   * By default, withdraws to the same chain (instant, no 7-day delay).
   * Optionally, withdraw to a different chain (requires gas on destination).
   *
   * @param amount - Amount of USDC to withdraw (as a decimal string)
   * @param options - Optional withdrawal options
   * @returns Withdrawal result with transaction hash
   *
   * @example
   * ```typescript
   * // Withdraw to same chain (instant!)
   * await gateway.withdraw('50');
   *
   * // Withdraw to Base Sepolia (requires ETH on Base for gas)
   * await gateway.withdraw('25', { chain: 'baseSepolia' });
   * ```
   */
  async withdraw(
    amount: string,
    options?: {
      /** Destination chain (defaults to same chain) */
      chain?: SupportedChainName;
      /** Recipient address (defaults to your address) */
      recipient?: Address;
      /** Max fee willing to pay in USDC (defaults to 2.01) */
      maxFee?: string;
    },
  ): Promise<WithdrawResult> {
    // Find destination chain config
    const destinationChainName = options?.chain ?? this.getChainName();
    const destConfig = CHAIN_CONFIGS[destinationChainName];
    if (!destConfig) {
      throw new Error(`Unsupported destination chain: ${destinationChainName}`);
    }

    const withdrawAmount = parseUnits(amount, 6);
    const recipient = options?.recipient ?? this.account.address;
    const maxFee = parseUnits(options?.maxFee ?? '2.01', 6);

    // Check available balance
    const balances = await this.getBalances();
    if (balances.gateway.available < withdrawAmount) {
      throw new Error(
        `Insufficient available balance. Have: ${balances.gateway.formattedAvailable}, Need: ${amount}`,
      );
    }

    // Create burn intent
    const burnIntent = this.createBurnIntent(
      this.chainConfig,
      destConfig,
      withdrawAmount,
      recipient,
      maxFee,
    );

    // Sign the burn intent
    const signature = await this.account.signTypedData({
      domain: { name: 'GatewayWallet', version: '1' },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
        ],
        TransferSpec: [
          { name: 'version', type: 'uint32' },
          { name: 'sourceDomain', type: 'uint32' },
          { name: 'destinationDomain', type: 'uint32' },
          { name: 'sourceContract', type: 'bytes32' },
          { name: 'destinationContract', type: 'bytes32' },
          { name: 'sourceToken', type: 'bytes32' },
          { name: 'destinationToken', type: 'bytes32' },
          { name: 'sourceDepositor', type: 'bytes32' },
          { name: 'destinationRecipient', type: 'bytes32' },
          { name: 'sourceSigner', type: 'bytes32' },
          { name: 'destinationCaller', type: 'bytes32' },
          { name: 'value', type: 'uint256' },
          { name: 'salt', type: 'bytes32' },
          { name: 'hookData', type: 'bytes' },
        ],
        BurnIntent: [
          { name: 'maxBlockHeight', type: 'uint256' },
          { name: 'maxFee', type: 'uint256' },
          { name: 'spec', type: 'TransferSpec' },
        ],
      },
      primaryType: 'BurnIntent',
      message: burnIntent,
    });

    // Get attestation from Gateway API
    const apiUrl = this.isTestnet() ? GATEWAY_API_TESTNET : GATEWAY_API_MAINNET;
    const response = await fetch(`${apiUrl}/transfer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.gatewayApiHeaders(),
      },
      body: JSON.stringify([{ burnIntent, signature }], (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      ),
    });

    const result = (await response.json()) as {
      success?: boolean;
      error?: string;
      message?: string;
      attestation?: string;
      signature?: string;
    };

    if (
      result.success === false ||
      result.error ||
      !result.attestation ||
      !result.signature
    ) {
      throw new Error(
        `Gateway API error: ${result.message || result.error || JSON.stringify(result)}`,
      );
    }

    // Create destination chain client for minting
    const destTransport = destConfig.rpcUrl ? http(destConfig.rpcUrl) : http();
    const destWalletClient = createWalletClient({
      account: this.account,
      chain: destConfig.chain,
      transport: destTransport,
    });
    const destPublicClient = createPublicClient({
      chain: destConfig.chain,
      transport: destTransport,
    });

    // Mint on destination chain
    const mintTxHash = await destWalletClient.writeContract({
      address: destConfig.gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [result.attestation as Hex, result.signature as Hex],
    });

    try {
      await destPublicClient.waitForTransactionReceipt({ hash: mintTxHash });
    } catch (err) {
      throw new Error(`Mint transaction failed: ${mintTxHash}`, { cause: err });
    }

    return {
      mintTxHash,
      amount: withdrawAmount,
      formattedAmount: amount,
      sourceChain: this.chainConfig.chain.name,
      destinationChain: destConfig.chain.name,
      recipient,
    };
  }

  /**
   * Transfer USDC to any supported chain (alias for withdraw with destination chain).
   * @deprecated Use `withdraw({ chain })` instead
   */
  async transfer(
    amount: string,
    destinationChain: SupportedChainName,
    recipient?: Address,
  ): Promise<WithdrawResult> {
    return this.withdraw(amount, { chain: destinationChain, recipient });
  }

  /**
   * Create a burn intent for a transfer.
   */
  private createBurnIntent(
    from: ChainConfig,
    to: ChainConfig,
    value: bigint,
    recipient: Address,
    maxFee: bigint,
  ) {
    const addressToBytes32 = (addr: string): Hex =>
      pad(addr.toLowerCase() as Address, { size: 32 });

    return {
      maxBlockHeight: maxUint256,
      maxFee,
      spec: {
        version: 1,
        sourceDomain: from.domain,
        destinationDomain: to.domain,
        sourceContract: addressToBytes32(from.gatewayWallet),
        destinationContract: addressToBytes32(to.gatewayMinter),
        sourceToken: addressToBytes32(from.usdc),
        destinationToken: addressToBytes32(to.usdc),
        sourceDepositor: addressToBytes32(this.account.address),
        destinationRecipient: addressToBytes32(recipient),
        sourceSigner: addressToBytes32(this.account.address),
        destinationCaller: addressToBytes32(zeroAddress),
        value,
        salt: `0x${randomBytes(32).toString('hex')}` as Hex,
        hookData: '0x' as Hex,
      },
    };
  }

  // ============================================================================
  // TRANSFER QUERIES
  // ============================================================================

  /**
   * Get a single x402 transfer by ID.
   *
   * @param id - The transfer UUID
   * @returns Transfer object
   */
  async getTransferById(id: string): Promise<TransferResponse> {
    const apiBaseUrl = this.isTestnet() ? GATEWAY_API_TESTNET : GATEWAY_API_MAINNET;
    const response = await fetch(
      `${apiBaseUrl}/x402/transfers/${encodeURIComponent(id)}`,
      { method: 'GET', headers: this.gatewayApiHeaders() },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Gateway getTransferById failed (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as TransferResponse;
  }

  /**
   * Search x402 transfers with optional filters.
   *
   * Supports cursor-based pagination via `pageAfter` / `pageBefore`.
   * When `network` is omitted, defaults to the client's chain (e.g., `eip155:84532`).
   * When `status` is provided, also provide `from`, `to`, or `nonce`.
   *
   * @param params - Optional transfer search filters
   * @returns Paginated transfer search response
   */
  async searchTransfers(
    params: SearchTransfersParams = {},
  ): Promise<SearchTransfersResponse> {
    const apiBaseUrl = this.isTestnet() ? GATEWAY_API_TESTNET : GATEWAY_API_MAINNET;

    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.nonce) query.set('nonce', params.nonce);
    const network = params.network ?? `eip155:${this.chainConfig.chain.id}`;
    query.set('network', network);
    if (params.status) query.set('status', params.status);
    if (params.token) query.set('token', params.token);
    if (params.startDate) query.set('startDate', params.startDate);
    if (params.endDate) query.set('endDate', params.endDate);
    if (typeof params.pageSize === 'number')
      query.set('pageSize', String(params.pageSize));
    if (params.pageAfter) query.set('pageAfter', params.pageAfter);
    if (params.pageBefore) query.set('pageBefore', params.pageBefore);

    const path = `${apiBaseUrl}/x402/transfers`;
    const queryString = query.toString().replaceAll('%3A', ':');
    const url = queryString ? `${path}?${queryString}` : path;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.gatewayApiHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Gateway searchTransfers failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as SearchTransfersResponse;
    const linkHeader = response.headers?.get?.('Link') ?? null;
    const pagination = this.parseLinkHeader(linkHeader);

    if (!pagination) {
      return data;
    }

    return { ...data, pagination };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private gatewayApiHeaders(): Record<string, string> {
    return this._headers;
  }

  /**
   * Check if this client is connected to a testnet.
   */
  private isTestnet(): boolean {
    const testnetChainIds = new Set<number>(
      (
        [
          'arbitrumSepolia',
          'arcTestnet',
          'avalancheFuji',
          'baseSepolia',
          'sepolia',
          'hyperEvmTestnet',
          'optimismSepolia',
          'polygonAmoy',
          'seiAtlantic',
          'sonicTestnet',
          'unichainSepolia',
          'worldChainSepolia',
        ] as SupportedChainName[]
      ).map((name) => CHAIN_CONFIGS[name].chain.id),
    );
    return testnetChainIds.has(this.chainConfig.chain.id);
  }

  /**
   * Parse pagination from an RFC 5988 Link header.
   * Could be replaced with 'http-link-header' library
   *
   * Example:
   * <https://.../transfers?pageAfter=...>; rel="next", <...>; rel="self"
   */
  private parseLinkHeader(linkHeader: string | null): CursorPagination | undefined {
    if (!linkHeader) {
      return undefined;
    }

    const pagination: CursorPagination = {};
    const linkRegex = /<([^>]+)>\s*;\s*rel="([^"]+)"/g;
    let match: RegExpExecArray | null = linkRegex.exec(linkHeader);

    while (match) {
      const [, url, rel] = match;
      if (rel === 'self' || rel === 'first' || rel === 'prev' || rel === 'next') {
        pagination[rel] = url;
      }
      match = linkRegex.exec(linkHeader);
    }

    if (pagination.next) {
      const cursor = this.getQueryParam(pagination.next, 'pageAfter');
      if (cursor) pagination.pageAfter = cursor;
    }
    if (pagination.prev) {
      const cursor = this.getQueryParam(pagination.prev, 'pageBefore');
      if (cursor) pagination.pageBefore = cursor;
    }

    return Object.keys(pagination).length > 0 ? pagination : undefined;
  }

  private getQueryParam(url: string, key: string): string | undefined {
    try {
      return new URL(url).searchParams.get(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  // ============================================================================
  // TRUSTLESS WITHDRAWAL (Emergency use only)
  // ============================================================================

  /**
   * Get the trustless withdrawal delay in blocks (~7 days).
   *
   * NOTE: This is for the emergency trustless withdrawal flow only.
   * For normal withdrawals, use `transfer()` to the same chain.
   *
   * @returns Number of blocks to wait after initiating trustless withdrawal
   */
  async getTrustlessWithdrawalDelay(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'withdrawalDelay',
    });
  }

  /**
   * Get the block at which a pending trustless withdrawal becomes available.
   *
   * @param address - Optional address to check (defaults to account address)
   * @returns Block number, or 0n if no pending withdrawal
   */
  async getTrustlessWithdrawalBlock(address?: Address): Promise<bigint> {
    const target = address ?? this.account.address;
    return this.publicClient.readContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'withdrawalBlock',
      args: [this.chainConfig.usdc, target],
    });
  }

  /**
   * Initiate a trustless withdrawal from the Gateway Wallet.
   *
   * ⚠️ **WARNING: This is for emergency use only!**
   *
   * Use this only when Circle's Gateway API is unavailable. For normal
   * withdrawals, use `transfer()` to the same chain - it's instant.
   *
   * After calling this, you must wait ~7 days (`withdrawalDelay` blocks)
   * before calling `completeTrustlessWithdrawal()`.
   *
   * @param amount - Amount of USDC to withdraw (as a decimal string)
   * @returns Withdrawal initiation result
   */
  async initiateTrustlessWithdrawal(
    amount: string,
  ): Promise<TrustlessWithdrawalInitResult> {
    const withdrawAmount = parseUnits(amount, 6);

    // Check available balance
    const balance = await this.getBalance();
    if (balance.available < withdrawAmount) {
      throw new Error(
        `Insufficient available balance. Have: ${balance.formattedAvailable}, Need: ${amount}`,
      );
    }

    // Initiate withdrawal
    const txHash = await this.walletClient.writeContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'initiateWithdrawal',
      args: [this.chainConfig.usdc, withdrawAmount],
      gas: 100000n,
    });

    try {
      await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (err) {
      throw new Error(`Trustless withdrawal initiation failed: ${txHash}`, {
        cause: err,
      });
    }

    // Get the withdrawal block
    const withdrawalBlock = await this.getTrustlessWithdrawalBlock();

    return {
      txHash,
      amount: withdrawAmount,
      formattedAmount: amount,
      withdrawalBlock,
    };
  }

  /**
   * Complete a trustless withdrawal after the ~7-day delay period.
   *
   * ⚠️ **WARNING: This is for emergency use only!**
   *
   * Use this only when Circle's Gateway API is unavailable. For normal
   * withdrawals, use `transfer()` to the same chain - it's instant.
   *
   * @returns Withdrawal result
   */
  async completeTrustlessWithdrawal(): Promise<TrustlessWithdrawalResult> {
    // Check withdrawable balance
    const balance = await this.getBalance();
    if (balance.withdrawable === 0n) {
      const withdrawalBlock = await this.getTrustlessWithdrawalBlock();
      const currentBlock = await this.publicClient.getBlockNumber();

      if (withdrawalBlock > 0n && currentBlock < withdrawalBlock) {
        throw new Error(
          `Trustless withdrawal not yet available. Current block: ${currentBlock}, Available at: ${withdrawalBlock}`,
        );
      }

      throw new Error(
        'No withdrawable balance. Call initiateTrustlessWithdrawal() first.',
      );
    }

    const withdrawAmount = balance.withdrawable;

    // Complete withdrawal
    const txHash = await this.walletClient.writeContract({
      address: this.chainConfig.gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'withdraw',
      args: [this.chainConfig.usdc],
      gas: 100000n,
    });

    try {
      await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (err) {
      throw new Error(`Trustless withdrawal completion failed: ${txHash}`, {
        cause: err,
      });
    }

    return {
      txHash,
      amount: withdrawAmount,
      formattedAmount: formatUnits(withdrawAmount, 6),
    };
  }
}
