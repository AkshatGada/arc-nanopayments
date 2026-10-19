import { CIRCLE_BATCHING_SCHEME } from '../constants';
import { supportsBatching } from '../detection';
import type { BatchEvmScheme } from './BatchEvmScheme';

/**
 * PaymentRequirements interface (minimal subset needed).
 */
interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/**
 * PaymentPayload interface (minimal subset needed).
 */
interface PaymentPayload {
  x402Version: number;
  payload: unknown;
}

/**
 * SchemeNetworkClient interface from @x402/core.
 */
interface SchemeNetworkClient {
  readonly scheme: string;
  createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>>;
}

/**
 * Composite EVM Scheme that dispatches between BatchEvmScheme and a fallback.
 *
 * When both BatchEvmScheme and ExactEvmScheme register for the same `scheme`
 * ("exact") on the same network wildcard ("eip155:*"), x402Client uses
 * first-registered-wins. This means one scheme always shadows the other.
 *
 * CompositeEvmScheme solves this by registering once and dispatching at
 * runtime: if the payment requirements include batching metadata
 * (`supportsBatching()`), it delegates to BatchEvmScheme; otherwise it
 * delegates to the fallback (typically ExactEvmScheme).
 *
 * @example
 * ```typescript
 * import { CompositeEvmScheme, BatchEvmScheme } from "@circle-fin/x402-batching/client";
 * import { ExactEvmScheme } from "@x402/evm/exact/client";
 *
 * const composite = new CompositeEvmScheme(
 *   new BatchEvmScheme(signer),
 *   new ExactEvmScheme(signer),
 * );
 * client.register("eip155:*", composite);
 * ```
 */
export class CompositeEvmScheme implements SchemeNetworkClient {
  readonly scheme = CIRCLE_BATCHING_SCHEME;

  constructor(
    private readonly batchScheme: BatchEvmScheme,
    private readonly fallbackScheme: SchemeNetworkClient,
  ) {
    if (fallbackScheme.scheme !== CIRCLE_BATCHING_SCHEME) {
      throw new Error(
        `CompositeEvmScheme: fallbackScheme.scheme must be "${CIRCLE_BATCHING_SCHEME}", ` +
          `got "${fallbackScheme.scheme}"`,
      );
    }
  }

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    if (supportsBatching(paymentRequirements)) {
      return this.batchScheme.createPaymentPayload(x402Version, paymentRequirements);
    }
    return this.fallbackScheme.createPaymentPayload(x402Version, paymentRequirements);
  }
}
