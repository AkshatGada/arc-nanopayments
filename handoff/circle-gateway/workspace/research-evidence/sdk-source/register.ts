import { BatchEvmScheme } from './BatchEvmScheme';
import { CompositeEvmScheme } from './CompositeEvmScheme';
import type { BatchEvmSigner } from '../types';

/**
 * x402Client-like interface (minimal subset needed for registration).
 */
interface X402ClientLike {
  register(network: string, client: { readonly scheme: string }): unknown;
}

/**
 * SchemeNetworkClient-like interface (minimal subset for fallback).
 */
interface SchemeNetworkClientLike {
  readonly scheme: string;
  createPaymentPayload(
    x402Version: number,
    paymentRequirements: {
      scheme: string;
      network: string;
      asset: string;
      amount: string;
      payTo: string;
      maxTimeoutSeconds: number;
      extra?: Record<string, unknown>;
    },
  ): Promise<{ x402Version: number; payload: unknown }>;
}

/**
 * Configuration for registering batch scheme.
 */
export interface RegisterBatchSchemeConfig {
  /** The EVM signer for signing payment authorizations */
  signer: BatchEvmSigner;
  /** Networks to register for (default: all EVM networks via wildcard) */
  networks?: string[];
  /**
   * Optional fallback SchemeNetworkClient for non-batching "exact" payments.
   *
   * When provided, a CompositeEvmScheme is registered that dispatches to
   * BatchEvmScheme for Gateway payments and to the fallback for standard
   * on-chain payments. This avoids the scheme collision where x402Client's
   * first-registered-wins policy causes one scheme to shadow the other.
   *
   * @example
   * ```typescript
   * import { ExactEvmScheme } from "@x402/evm/exact/client";
   *
   * registerBatchScheme(client, {
   *   signer: evmSigner,
   *   fallbackScheme: new ExactEvmScheme(evmSigner),
   * });
   * ```
   */
  fallbackScheme?: SchemeNetworkClientLike;
}

/**
 * Register batch scheme with an x402Client.
 *
 * This registers a BatchEvmScheme that can handle payment requirements
 * with `extra.name === "GatewayWalletBatched"`. The scheme signs EIP-3009
 * authorizations against the batch wallet contract instead of USDC.
 *
 * When `fallbackScheme` is provided, a CompositeEvmScheme is registered
 * instead, which handles both batch and standard payments in a single
 * registration — no need to separately register ExactEvmScheme.
 *
 * @param client - The x402Client to register with
 * @param config - Configuration including the EVM signer
 * @returns The registered scheme instance
 *
 * @example
 * ```typescript
 * import { x402Client } from "@x402/core/client";
 * import { registerBatchScheme } from "@circle-fin/x402-batching/client";
 * import { ExactEvmScheme } from "@x402/evm/exact/client";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const account = privateKeyToAccount("0x...");
 * const client = new x402Client();
 *
 * // Handles both batch and standard EVM payments:
 * registerBatchScheme(client, {
 *   signer: account,
 *   fallbackScheme: new ExactEvmScheme(account),
 * });
 * ```
 */
export function registerBatchScheme(
  client: X402ClientLike,
  config: RegisterBatchSchemeConfig & { fallbackScheme: SchemeNetworkClientLike },
): CompositeEvmScheme;
export function registerBatchScheme(
  client: X402ClientLike,
  config: Omit<RegisterBatchSchemeConfig, 'fallbackScheme'>,
): BatchEvmScheme;
export function registerBatchScheme(
  client: X402ClientLike,
  config: RegisterBatchSchemeConfig,
): BatchEvmScheme | CompositeEvmScheme;
export function registerBatchScheme(
  client: X402ClientLike,
  config: RegisterBatchSchemeConfig,
): BatchEvmScheme | CompositeEvmScheme {
  const batchScheme = new BatchEvmScheme(config.signer);

  const schemeToRegister = config.fallbackScheme
    ? new CompositeEvmScheme(batchScheme, config.fallbackScheme)
    : batchScheme;

  // Register for specified networks or use wildcard for all EVM networks
  const networks = config.networks ?? ['eip155:*'];
  for (const network of networks) {
    client.register(network, schemeToRegister);
  }

  return schemeToRegister;
}
