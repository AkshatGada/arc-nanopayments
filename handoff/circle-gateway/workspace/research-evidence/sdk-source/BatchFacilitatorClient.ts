import type { BatchFacilitatorConfig } from '../types';
import {
  warnHookFailure,
  type FacilitatorBeforeVerifyHook,
  type FacilitatorAfterVerifyHook,
  type FacilitatorOnVerifyFailureHook,
  type FacilitatorBeforeSettleHook,
  type FacilitatorAfterSettleHook,
  type FacilitatorOnSettleFailureHook,
  type VerifyContext,
  type VerifyResultContext,
  type VerifyFailureContext,
  type SettleContext,
  type SettleResultContext,
  type SettleFailureContext,
} from '../hooks';

/**
 * PaymentPayload interface (minimal subset needed).
 */
interface PaymentPayload {
  x402Version: number;
  resource?: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepted?: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

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
 * VerifyResponse from facilitator.
 */
interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/**
 * SettleResponse from facilitator.
 */
interface SettleResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction: string;
  network: string;
}

/**
 * SupportedKind from facilitator.
 */
interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: string;
  extra?: Record<string, unknown>;
}

/**
 * SupportedResponse from facilitator.
 */
interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}

/**
 * FacilitatorClient interface from @x402/core.
 */
interface FacilitatorClient {
  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse>;

  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse>;

  getSupported(): Promise<SupportedResponse>;
}

/**
 * Circle Gateway Facilitator Client.
 *
 * A FacilitatorClient implementation that communicates with Circle Gateway's
 * x402 endpoints for verification and settlement of batched payments.
 *
 * The client calls:
 * - `POST /v1/x402/verify` for payment verification
 * - `POST /v1/x402/settle` for payment settlement
 * - `GET /v1/x402/supported` for supported payment kinds
 *
 * Lifecycle hooks (`onBeforeVerify`, `onAfterVerify`, `onVerifyFailure`,
 * `onBeforeSettle`, `onAfterSettle`, `onSettleFailure`) are supported with
 * the same semantics as the standard SDK's `x402Facilitator` — see
 * https://docs.x402.org/advanced-concepts/lifecycle-hooks for details.
 *
 * @example
 * ```typescript
 * import { x402ResourceServer } from "@x402/core/server";
 * import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
 *
 * const circleClient = new BatchFacilitatorClient({
 *   url: "https://gateway.circle.com",
 * });
 *
 * const server = new x402ResourceServer([circleClient]);
 * await server.initialize();
 * ```
 */
export class BatchFacilitatorClient implements FacilitatorClient {
  readonly url: string;
  private readonly _createAuthHeaders?: BatchFacilitatorConfig['createAuthHeaders'];
  private readonly _headers: Record<string, string>;

  private beforeVerifyHooks: FacilitatorBeforeVerifyHook[] = [];
  private afterVerifyHooks: FacilitatorAfterVerifyHook[] = [];
  private onVerifyFailureHooks: FacilitatorOnVerifyFailureHook[] = [];
  private beforeSettleHooks: FacilitatorBeforeSettleHook[] = [];
  private afterSettleHooks: FacilitatorAfterSettleHook[] = [];
  private onSettleFailureHooks: FacilitatorOnSettleFailureHook[] = [];

  /**
   * Creates a new BatchFacilitatorClient.
   *
   * @param config - Configuration including Gateway URL and optional auth headers
   */
  constructor(config: BatchFacilitatorConfig = {}) {
    // Ensure URL doesn't have trailing slash
    this.url = (config.url ?? 'https://gateway-api.circle.com').replace(/\/$/, '');
    this._createAuthHeaders = config.createAuthHeaders;
    this._headers = config.headers ?? {};
  }

  private gatewayApiHeaders(base: Record<string, string> = {}): Record<string, string> {
    return { ...base, ...this._headers };
  }

  /**
   * Register a hook that runs before facilitator verification.
   * Return `{ abort: true, reason }` to short-circuit and treat the payment
   * as invalid (returns `{ isValid: false, invalidReason: reason }`).
   */
  onBeforeVerify(hook: FacilitatorBeforeVerifyHook): this {
    this.beforeVerifyHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs after a successful verification (`isValid: true`).
   * Not invoked when verification fails — use {@link onVerifyFailure} for that.
   */
  onAfterVerify(hook: FacilitatorAfterVerifyHook): this {
    this.afterVerifyHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs when verification fails — either when the
   * facilitator returns `isValid: false` or when an exception is thrown.
   * Return `{ recovered: true, result }` to override the failure with a
   * successful verification result.
   */
  onVerifyFailure(hook: FacilitatorOnVerifyFailureHook): this {
    this.onVerifyFailureHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs before facilitator settlement. Return
   * `{ abort: true, reason }` to throw `Error("Settlement aborted: <reason>")`.
   */
  onBeforeSettle(hook: FacilitatorBeforeSettleHook): this {
    this.beforeSettleHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs after a successful settlement.
   */
  onAfterSettle(hook: FacilitatorAfterSettleHook): this {
    this.afterSettleHooks.push(hook);
    return this;
  }

  /**
   * Register a hook that runs when settlement throws. Return
   * `{ recovered: true, result }` to swallow the error and return `result`
   * to the caller as if settlement had succeeded.
   */
  onSettleFailure(hook: FacilitatorOnSettleFailureHook): this {
    this.onSettleFailureHooks.push(hook);
    return this;
  }

  /**
   * Verify a payment with Circle Gateway.
   *
   * @param paymentPayload - The payment payload to verify
   * @param paymentRequirements - The payment requirements
   * @returns Verification response
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const context: VerifyContext = {
      paymentPayload,
      requirements: paymentRequirements,
    };

    for (const hook of this.beforeVerifyHooks) {
      const result = await hook(context);
      if (result && 'abort' in result && result.abort) {
        return {
          isValid: false,
          invalidReason: result.reason,
        };
      }
    }

    try {
      const verifyResult = await this.callVerify(paymentPayload, paymentRequirements);

      if (!verifyResult.isValid) {
        const failureContext: VerifyFailureContext = {
          ...context,
          error: new Error(verifyResult.invalidReason || 'Verification failed'),
        };

        for (const hook of this.onVerifyFailureHooks) {
          const result = await hook(failureContext);
          if (result && 'recovered' in result && result.recovered) {
            const recoveredContext: VerifyResultContext = {
              ...context,
              result: result.result,
            };
            for (const [index, afterHook] of this.afterVerifyHooks.entries()) {
              try {
                await afterHook(recoveredContext);
              } catch (err) {
                warnHookFailure(
                  'BatchFacilitatorClient',
                  'afterVerify',
                  `manual hook #${index}`,
                  err,
                );
              }
            }
            return result.result;
          }
        }

        return verifyResult;
      }

      const resultContext: VerifyResultContext = { ...context, result: verifyResult };
      for (const [index, hook] of this.afterVerifyHooks.entries()) {
        try {
          await hook(resultContext);
        } catch (err) {
          warnHookFailure(
            'BatchFacilitatorClient',
            'afterVerify',
            `manual hook #${index}`,
            err,
          );
        }
      }

      return verifyResult;
    } catch (error) {
      const failureContext: VerifyFailureContext = {
        ...context,
        error: error as Error,
      };

      for (const hook of this.onVerifyFailureHooks) {
        const result = await hook(failureContext);
        if (result && 'recovered' in result && result.recovered) {
          return result.result;
        }
      }

      throw error;
    }
  }

  /**
   * Settle a payment with Circle Gateway.
   *
   * @param paymentPayload - The payment payload to settle
   * @param paymentRequirements - The payment requirements
   * @returns Settlement response
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const context: SettleContext = {
      paymentPayload,
      requirements: paymentRequirements,
    };

    for (const hook of this.beforeSettleHooks) {
      const result = await hook(context);
      if (result && 'abort' in result && result.abort) {
        throw new Error(`Settlement aborted: ${result.reason}`);
      }
    }

    try {
      const settleResult = await this.callSettle(paymentPayload, paymentRequirements);

      const resultContext: SettleResultContext = {
        ...context,
        result: settleResult,
      };
      for (const [index, hook] of this.afterSettleHooks.entries()) {
        try {
          await hook(resultContext);
        } catch (err) {
          warnHookFailure(
            'BatchFacilitatorClient',
            'afterSettle',
            `manual hook #${index}`,
            err,
          );
        }
      }

      return settleResult;
    } catch (error) {
      const failureContext: SettleFailureContext = {
        ...context,
        error: error as Error,
      };

      for (const hook of this.onSettleFailureHooks) {
        const result = await hook(failureContext);
        if (result && 'recovered' in result && result.recovered) {
          return result.result;
        }
      }

      throw error;
    }
  }

  /**
   * HTTP call into Circle Gateway's /verify endpoint. Split out so the hook
   * machinery in `verify()` reads cleanly.
   */
  private async callVerify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    let headers = this.gatewayApiHeaders({
      'Content-Type': 'application/json',
    });

    if (this._createAuthHeaders) {
      const authHeaders = await this._createAuthHeaders();
      headers = { ...headers, ...authHeaders.verify };
    }

    const response = await fetch(`${this.url}/v1/x402/verify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        paymentPayload: this.toJsonSafe(paymentPayload),
        paymentRequirements: this.toJsonSafe(paymentRequirements),
      }),
    });

    const data = await response.json();

    if (typeof data === 'object' && data !== null && 'isValid' in data) {
      return data as VerifyResponse;
    }

    throw new Error(
      `Circle Gateway verify failed (${response.status}): ${JSON.stringify(data)}`,
    );
  }

  /**
   * HTTP call into Circle Gateway's /settle endpoint. Split out so the hook
   * machinery in `settle()` reads cleanly.
   */
  private async callSettle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    let headers = this.gatewayApiHeaders({
      'Content-Type': 'application/json',
    });

    if (this._createAuthHeaders) {
      const authHeaders = await this._createAuthHeaders();
      headers = { ...headers, ...authHeaders.settle };
    }

    const response = await fetch(`${this.url}/v1/x402/settle`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        paymentPayload: this.toJsonSafe(paymentPayload),
        paymentRequirements: this.toJsonSafe(paymentRequirements),
      }),
    });

    const text = await response.text();
    if (!text) {
      throw new Error(
        `Circle Gateway settle returned empty response (${response.status})`,
      );
    }

    const data = JSON.parse(text);

    if (typeof data === 'object' && data !== null && 'success' in data) {
      return data as SettleResponse;
    }

    throw new Error(`Circle Gateway settle failed (${response.status}): ${text}`);
  }

  /**
   * Get supported payment kinds from Circle Gateway.
   *
   * This fetches the supported networks and their GatewayWallet contract addresses.
   * The response includes `extra.verifyingContract` for each supported network.
   *
   * @returns Supported payment kinds and extensions
   */
  async getSupported(): Promise<SupportedResponse> {
    let headers = this.gatewayApiHeaders({
      'Content-Type': 'application/json',
    });

    if (this._createAuthHeaders) {
      const authHeaders = await this._createAuthHeaders();
      headers = { ...headers, ...authHeaders.supported };
    }

    const response = await fetch(`${this.url}/v1/x402/supported`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Circle Gateway getSupported failed (${response.status}): ${errorText}`,
      );
    }

    return (await response.json()) as SupportedResponse;
  }

  /**
   * Helper to convert objects to JSON-safe format.
   * Handles BigInt and other non-JSON types.
   */
  private toJsonSafe(obj: unknown): unknown {
    return JSON.parse(
      JSON.stringify(obj, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    );
  }
}
