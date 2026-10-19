import { ExactEvmScheme } from '@x402/evm/exact/server';
import type { Network, PaymentRequirements } from '@x402/core/types';
import { CHAIN_CONFIGS } from '../client/GatewayClient';
import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS } from '../constants';

/**
 * Gateway EVM Scheme for x402 resource servers.
 *
 * Extends `ExactEvmScheme` with two Gateway-specific behaviors:
 *
 * 1. **enhancePaymentRequirements** — merges `supportedKind.extra` (e.g.
 *    `verifyingContract`) into `paymentRequirements.extra`. The base
 *    `ExactEvmScheme` discards this, but Gateway clients need it to
 *    construct the correct EIP-712 signing domain.
 *
 * 2. **Money parsers** — registers USDC address mappings for all
 *    Gateway-supported networks so `parsePrice("$0.01")` works
 *    without manual `registerMoneyParser()` calls.
 *
 * @example
 * ```typescript
 * import { GatewayEvmScheme } from "@circle-fin/x402-batching/server";
 * import { x402ResourceServer } from "@x402/express";
 *
 * const resourceServer = new x402ResourceServer(facilitators)
 *   .register("eip155:5042002", new GatewayEvmScheme());
 * ```
 */
export class GatewayEvmScheme extends ExactEvmScheme {
  constructor() {
    super();
    this.registerGatewayMoneyParsers();
  }

  /**
   * Enhances payment requirements by merging the facilitator's extra data.
   *
   * The base `ExactEvmScheme.enhancePaymentRequirements` returns requirements
   * unchanged, dropping `supportedKind.extra`. Gateway payments require
   * `extra.verifyingContract` (and other fields like `name`, `version`) to
   * be present for clients to construct the correct signing domain.
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[],
  ): Promise<PaymentRequirements> {
    void extensionKeys;
    return {
      ...paymentRequirements,
      maxTimeoutSeconds: Math.max(
        paymentRequirements.maxTimeoutSeconds,
        GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
      ),
      extra: {
        ...paymentRequirements.extra,
        ...supportedKind.extra,
      },
    };
  }

  /**
   * Registers money parsers for all Gateway-supported networks.
   *
   * Builds a `network → USDC address` lookup from `CHAIN_CONFIGS` and
   * registers a single parser that converts dollar amounts to USDC atomic
   * units (6 decimals) for any Gateway-supported chain.
   *
   * Returns `null` for unknown networks so `ExactEvmScheme`'s built-in
   * parser handles them.
   */
  private registerGatewayMoneyParsers(): void {
    // Build network → USDC address map from CHAIN_CONFIGS
    const networkUsdcMap = new Map<string, string>();
    for (const config of Object.values(CHAIN_CONFIGS)) {
      const network = `eip155:${config.chain.id}`;
      networkUsdcMap.set(network, config.usdc);
    }

    this.registerMoneyParser(async (amount: number, network: Network) => {
      const usdcAddress = networkUsdcMap.get(network);
      if (!usdcAddress) {
        return null; // Not a Gateway network — let default parser handle it
      }
      return {
        amount: Math.round(amount * 1e6).toString(),
        asset: usdcAddress,
      };
    });
  }
}
