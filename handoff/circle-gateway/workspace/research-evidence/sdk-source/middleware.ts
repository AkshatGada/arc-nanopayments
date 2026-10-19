import type { IncomingMessage, ServerResponse } from 'http';
import { BatchFacilitatorClient } from './BatchFacilitatorClient';
import {
  CIRCLE_BATCHING_SCHEME,
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '../constants';
import {
  warnHookFailure,
  type BeforeVerifyHook,
  type AfterVerifyHook,
  type OnVerifyFailureHook,
  type BeforeSettleHook,
  type AfterSettleHook,
  type OnSettleFailureHook,
  type OnVerifiedPaymentCanceledHook,
  type ProtectedRequestHook,
  type ProtectedRequestContext,
  type ProtectedRouteConfig,
  type VerifyContext,
  type VerifyResultContext,
  type VerifyFailureContext,
  type SettleContext,
  type SettleResultContext,
  type SettleFailureContext,
  type VerifiedPaymentCancellationReason,
  type VerifiedPaymentCanceledContext,
  type HookVerifyResponse,
  type HookSettleResponse,
} from '../hooks';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported network kind from facilitator.
 */
interface SupportedKind {
  network: string;
  extra?: {
    verifyingContract?: string;
    assets?: Array<{ address: string; symbol: string; decimals: number }>;
    [key: string]: unknown;
  };
}

/**
 * Extract the USDC token address from a SupportedKind's assets list.
 * Returns null if no USDC asset is found.
 */
function getUsdcAddress(kind: SupportedKind): string | null {
  const assets = kind.extra?.assets;
  if (!assets || assets.length === 0) return null;
  const usdc = assets.find((a) => a.symbol === 'USDC');
  return usdc?.address ?? null;
}

/**
 * Configuration for Gateway middleware.
 */
export interface GatewayMiddlewareConfig {
  /** Seller's wallet address to receive payments */
  sellerAddress: string;
  /**
   * Networks to accept payments on.
   * - If omitted, accepts payments on ALL Gateway-supported networks (recommended)
   * - Can be a single network string or array of networks
   * - Format: CAIP-2 (e.g., 'eip155:8453' for Base, 'eip155:5042002' for Arc Testnet)
   */
  networks?: string | string[];
  /**
   * Optional Gateway facilitator URL.
   * Defaults to mainnet: "https://gateway-api.circle.com".
   * For testnet, pass "https://gateway-api-testnet.circle.com".
   */
  facilitatorUrl?: string;
  /** Additional headers merged into every outbound facilitator request. */
  headers?: Record<string, string>;
  /** Optional resource description */
  description?: string;
}

/**
 * Payment requirements for 402 responses.
 */
export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    verifyingContract: string;
  };
}

/**
 * Express-compatible request with payment info.
 */
export interface PaymentRequest extends IncomingMessage {
  payment?: {
    /** Whether the payment was verified */
    verified: boolean;
    /** Payer's address */
    payer: string;
    /** Amount paid in smallest units */
    amount: string;
    /** Network the payment was made on */
    network: string;
    /** Transaction hash after settlement */
    transaction?: string;
  };
  body?: unknown;
}

/**
 * Express-compatible response.
 */
export interface PaymentResponse extends ServerResponse {
  json?: (data: unknown) => void;
  status?: (code: number) => PaymentResponse;
}

/**
 * Express-compatible next function.
 */
export type NextFunction = (err?: unknown) => void;

/**
 * Express-compatible middleware function.
 */
export type MiddlewareFunction = (
  req: PaymentRequest,
  res: PaymentResponse,
  next: NextFunction,
) => void | Promise<void>;

// ============================================================================
// MIDDLEWARE FACTORY
// ============================================================================

/**
 * Gateway middleware instance.
 *
 * The middleware exposes lifecycle hooks that mirror the standard SDK's
 * `x402ResourceServer` and `x402HTTPResourceServer`:
 *
 * - `onProtectedRequest` — runs first, before any payment processing. Can grant
 *   access without payment (e.g. API key auth) or deny outright (returns 403).
 * - `onBeforeVerify` / `onAfterVerify` / `onVerifyFailure` — wrap the verify call.
 * - `onBeforeSettle` / `onAfterSettle` / `onSettleFailure` — wrap the settle call.
 * - `onVerifiedPaymentCanceled` — fires when a payment was verified but the
 *   protected handler erred and we never settled. (Note: with this transport
 *   middleware, settlement happens inline before `next()` runs, so the
 *   cancellation hook only fires when the same request encounters a settle
 *   failure that aborts further processing.)
 *
 * See https://docs.x402.org/advanced-concepts/lifecycle-hooks for the
 * canonical reference. All hooks return promises and can be chained.
 */
export interface GatewayMiddleware {
  /**
   * Require payment for a resource.
   *
   * @param price - Price in dollars (e.g., '$0.01' or '0.01')
   * @returns Express-compatible middleware
   *
   * @example
   * ```typescript
   * app.get('/resource', gateway.require('$0.01'), (req, res) => {
   *   res.json({ content: '...' });
   * });
   *
   * app.post('/generate', gateway.require('$0.05'), (req, res) => {
   *   res.json({ result: '...' });
   * });
   * ```
   */
  require: (price: string) => MiddlewareFunction;

  /**
   * Verify a payment without settling.
   */
  verify: (
    payment: unknown,
  ) => Promise<{ valid: boolean; payer?: string; error?: string }>;

  /**
   * Settle a verified payment.
   */
  settle: (
    payment: unknown,
  ) => Promise<{ success: boolean; transaction?: string; error?: string }>;

  /** See {@link GatewayMiddleware} for hook semantics. */
  onProtectedRequest: (hook: ProtectedRequestHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onBeforeVerify: (hook: BeforeVerifyHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onAfterVerify: (hook: AfterVerifyHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onVerifyFailure: (hook: OnVerifyFailureHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onBeforeSettle: (hook: BeforeSettleHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onAfterSettle: (hook: AfterSettleHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onSettleFailure: (hook: OnSettleFailureHook) => GatewayMiddleware;
  /** See {@link GatewayMiddleware} for hook semantics. */
  onVerifiedPaymentCanceled: (hook: OnVerifiedPaymentCanceledHook) => GatewayMiddleware;
}

/**
 * Parse a price string (e.g., '$0.01' or '0.01') to atomic units.
 */
function parsePrice(price: string): string {
  const numericPrice = price.replace(/[$]/g, '');
  const amount = parseFloat(numericPrice);
  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Invalid price: ${price}`);
  }
  // Convert to USDC atomic units (6 decimals)
  return Math.round(amount * 1_000_000).toString();
}

/**
 * Build a `ProtectedRequestContext` from the raw IncomingMessage.
 */
function buildProtectedRequestContext(req: PaymentRequest): ProtectedRequestContext {
  const url = req.url ?? '/';
  const path = url.split(/[?#]/)[0];
  return {
    method: (req.method ?? 'GET').toUpperCase(),
    path,
    url,
    getHeader: (name: string) => {
      const v = req.headers[name.toLowerCase()];
      if (Array.isArray(v)) return v[0];
      return v as string | undefined;
    },
  };
}

/**
 * Create a Gateway middleware instance.
 *
 * By default, accepts payments on ALL Gateway-supported networks. Buyers can
 * pay from any chain where they have Gateway balance.
 *
 * @param config - Middleware configuration
 * @returns Gateway middleware
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
 *
 * const app = express();
 *
 * // Accept payments on all Gateway-supported networks (recommended)
 * const gateway = createGatewayMiddleware({
 *   sellerAddress: '0x...',
 * });
 *
 * // Or restrict to specific networks
 * const gateway = createGatewayMiddleware({
 *   sellerAddress: '0x...',
 *   networks: ['eip155:5042002', 'eip155:84532'], // Arc Testnet + Base Sepolia
 * });
 *
 * app.get('/resource', gateway.require('$0.01'), (req, res) => {
 *   res.json({ content: 'Paid content!' });
 * });
 *
 * // Bypass payment for callers carrying an API key
 * gateway.onProtectedRequest(async (ctx) => {
 *   if (await isValidApiKey(ctx.getHeader('x-api-key'))) {
 *     return { grantAccess: true };
 *   }
 * });
 * ```
 */
export function createGatewayMiddleware(
  config: GatewayMiddlewareConfig,
): GatewayMiddleware {
  const facilitator = new BatchFacilitatorClient({
    url: config.facilitatorUrl,
    headers: config.headers,
  });

  // Normalize networks config
  const configuredNetworks = config.networks
    ? Array.isArray(config.networks)
      ? config.networks
      : [config.networks]
    : null; // null means "all networks"

  // Cache supported kinds from facilitator
  let cachedSupportedKinds: SupportedKind[] | null = null;

  async function getSupportedKinds(): Promise<SupportedKind[]> {
    if (cachedSupportedKinds) {
      return cachedSupportedKinds;
    }

    const supported = await facilitator.getSupported();
    cachedSupportedKinds = supported.kinds as SupportedKind[];
    return cachedSupportedKinds;
  }

  /**
   * Get networks to advertise in 402 response.
   */
  async function getAcceptedNetworks(): Promise<SupportedKind[]> {
    const allKinds = await getSupportedKinds();

    // Filter to configured networks if specified, otherwise use all
    if (configuredNetworks) {
      return allKinds.filter(
        (k) => configuredNetworks.includes(k.network) && k.extra?.verifyingContract,
      );
    }

    // Return all networks with verifying contracts
    return allKinds.filter((k) => k.extra?.verifyingContract);
  }

  /**
   * Create payment requirements for all accepted networks.
   */
  async function createAllPaymentRequirements(
    price: string,
  ): Promise<PaymentRequirements[]> {
    const networks = await getAcceptedNetworks();
    const amount = parsePrice(price);

    return networks
      .filter((kind) => getUsdcAddress(kind)) // Only include networks we have USDC addresses for
      .map((kind) => ({
        scheme: CIRCLE_BATCHING_SCHEME, // Must be 'exact' for Gateway API
        network: kind.network,
        asset: getUsdcAddress(kind)!, // Use actual USDC address
        amount,
        payTo: config.sellerAddress,
        maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS, // 7 days plus verification latency buffer
        extra: {
          name: CIRCLE_BATCHING_NAME,
          version: CIRCLE_BATCHING_VERSION,
          verifyingContract: kind.extra!.verifyingContract as string,
        },
      }));
  }

  /**
   * Create payment requirements for a specific network.
   */
  async function createPaymentRequirements(
    price: string,
    network: string,
  ): Promise<PaymentRequirements | null> {
    const networks = await getAcceptedNetworks();
    const kind = networks.find((k) => k.network === network);

    if (!kind || !kind.extra?.verifyingContract) {
      return null;
    }

    const usdcAddress = getUsdcAddress(kind);
    if (!usdcAddress) {
      return null;
    }

    return {
      scheme: CIRCLE_BATCHING_SCHEME, // Must be 'exact' for Gateway API
      network: kind.network,
      asset: usdcAddress, // Use actual USDC address
      amount: parsePrice(price),
      payTo: config.sellerAddress,
      maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS, // 7 days plus verification latency buffer
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: kind.extra.verifyingContract as string,
      },
    };
  }

  // ==========================================================================
  // Hook registries
  // ==========================================================================

  const protectedRequestHooks: ProtectedRequestHook[] = [];
  const beforeVerifyHooks: BeforeVerifyHook[] = [];
  const afterVerifyHooks: AfterVerifyHook[] = [];
  const onVerifyFailureHooks: OnVerifyFailureHook[] = [];
  const beforeSettleHooks: BeforeSettleHook[] = [];
  const afterSettleHooks: AfterSettleHook[] = [];
  const onSettleFailureHooks: OnSettleFailureHook[] = [];
  const onVerifiedPaymentCanceledHooks: OnVerifiedPaymentCanceledHook[] = [];

  // Run after-verify hooks. Returns a `skipHandler` directive if any hook
  // requested the resource handler be bypassed.
  async function runAfterVerifyHooks(
    context: VerifyContext,
    verifyResult: HookVerifyResponse,
  ): Promise<{ contentType?: string; body?: unknown } | undefined> {
    const resultContext: VerifyResultContext = { ...context, result: verifyResult };
    let skipHandler: { contentType?: string; body?: unknown } | undefined;
    for (const [index, hook] of afterVerifyHooks.entries()) {
      try {
        const directive = await hook(resultContext);
        if (directive && 'skipHandler' in directive && directive.skipHandler) {
          skipHandler = directive.response ?? {};
        }
      } catch (err) {
        warnHookFailure('GatewayMiddleware', 'afterVerify', `manual hook #${index}`, err);
      }
    }
    return skipHandler;
  }

  // Run a verify lifecycle (beforeVerify → facilitator.verify → afterVerify
  // | onVerifyFailure). Returns either a verify response (with optional
  // `skipHandler` directive) or an `aborted` marker.
  async function runVerifyLifecycle(
    paymentPayload: { x402Version: number; payload: Record<string, unknown> },
    requirements: PaymentRequirements,
  ): Promise<
    | {
        kind: 'verified';
        result: HookVerifyResponse;
        skipHandler?: { contentType?: string; body?: unknown };
      }
    | { kind: 'aborted'; reason: string; message?: string }
    | { kind: 'failed'; result: HookVerifyResponse }
    | { kind: 'thrown'; error: Error }
  > {
    const context: VerifyContext = {
      paymentPayload,
      requirements,
    };

    for (const [index, hook] of beforeVerifyHooks.entries()) {
      try {
        const result = await hook(context);
        if (result && 'abort' in result && result.abort) {
          return { kind: 'aborted', reason: result.reason, message: result.message };
        }
        if (result && 'skip' in result && result.skip) {
          const skipHandler = await runAfterVerifyHooks(context, result.result);
          return { kind: 'verified', result: result.result, skipHandler };
        }
      } catch (err) {
        warnHookFailure(
          'GatewayMiddleware',
          'beforeVerify',
          `manual hook #${index}`,
          err,
        );
      }
    }

    try {
      const verifyResult = await facilitator.verify(paymentPayload, requirements);

      if (!verifyResult.isValid) {
        // failed verify — run onVerifyFailure
        const failureContext: VerifyFailureContext = {
          ...context,
          error: new Error(verifyResult.invalidReason || 'Verification failed'),
        };
        for (const hook of onVerifyFailureHooks) {
          try {
            const recovery = await hook(failureContext);
            if (recovery && 'recovered' in recovery && recovery.recovered) {
              const skipHandler = await runAfterVerifyHooks(context, recovery.result);
              return { kind: 'verified', result: recovery.result, skipHandler };
            }
          } catch (err) {
            warnHookFailure('GatewayMiddleware', 'onVerifyFailure', 'manual hook', err);
          }
        }
        return { kind: 'failed', result: verifyResult };
      }

      const skipHandler = await runAfterVerifyHooks(context, verifyResult);
      return { kind: 'verified', result: verifyResult, skipHandler };
    } catch (error) {
      const failureContext: VerifyFailureContext = {
        ...context,
        error: error as Error,
      };
      for (const hook of onVerifyFailureHooks) {
        try {
          const recovery = await hook(failureContext);
          if (recovery && 'recovered' in recovery && recovery.recovered) {
            const skipHandler = await runAfterVerifyHooks(context, recovery.result);
            return { kind: 'verified', result: recovery.result, skipHandler };
          }
        } catch (err) {
          warnHookFailure('GatewayMiddleware', 'onVerifyFailure', 'manual hook', err);
        }
      }
      return { kind: 'thrown', error: error as Error };
    }
  }

  // Run a settle lifecycle (beforeSettle → facilitator.settle → afterSettle
  // | onSettleFailure). Returns either a settle response or a control-flow
  // directive equivalent to the standard SDK's behavior.
  async function runSettleLifecycle(
    paymentPayload: { x402Version: number; payload: Record<string, unknown> },
    requirements: PaymentRequirements,
  ): Promise<
    | { kind: 'settled'; result: HookSettleResponse }
    | { kind: 'aborted'; reason: string; message?: string }
    | { kind: 'thrown'; error: Error }
  > {
    const context: SettleContext = {
      paymentPayload,
      requirements,
    };

    for (const [index, hook] of beforeSettleHooks.entries()) {
      try {
        const result = await hook(context);
        if (result && 'abort' in result && result.abort) {
          return { kind: 'aborted', reason: result.reason, message: result.message };
        }
        if (result && 'skip' in result && result.skip) {
          const skipResultContext: SettleResultContext = {
            ...context,
            result: result.result,
          };
          for (const [idx, after] of afterSettleHooks.entries()) {
            try {
              await after(skipResultContext);
            } catch (err) {
              warnHookFailure(
                'GatewayMiddleware',
                'afterSettle',
                `manual hook #${idx}`,
                err,
              );
            }
          }
          return { kind: 'settled', result: result.result };
        }
      } catch (err) {
        warnHookFailure(
          'GatewayMiddleware',
          'beforeSettle',
          `manual hook #${index}`,
          err,
        );
      }
    }

    try {
      const settleResult = await facilitator.settle(paymentPayload, requirements);
      const resultContext: SettleResultContext = { ...context, result: settleResult };

      for (const [index, hook] of afterSettleHooks.entries()) {
        try {
          await hook(resultContext);
        } catch (err) {
          warnHookFailure(
            'GatewayMiddleware',
            'afterSettle',
            `manual hook #${index}`,
            err,
          );
        }
      }

      return { kind: 'settled', result: settleResult };
    } catch (error) {
      const failureContext: SettleFailureContext = {
        ...context,
        error: error as Error,
      };
      for (const hook of onSettleFailureHooks) {
        try {
          const recovery = await hook(failureContext);
          if (recovery && 'recovered' in recovery && recovery.recovered) {
            return { kind: 'settled', result: recovery.result };
          }
        } catch (err) {
          warnHookFailure('GatewayMiddleware', 'onSettleFailure', 'manual hook', err);
        }
      }
      return { kind: 'thrown', error: error as Error };
    }
  }

  // Notify `onVerifiedPaymentCanceled` hooks that a verified payment never
  // reached settlement (e.g. because the protected handler threw, or
  // settlement itself failed in a non-recoverable way).
  async function dispatchVerifiedPaymentCanceled(
    paymentPayload: { x402Version: number; payload: Record<string, unknown> },
    requirements: PaymentRequirements,
    options: {
      reason: VerifiedPaymentCancellationReason;
      error?: unknown;
      responseStatus?: number;
    },
  ): Promise<void> {
    const context: VerifiedPaymentCanceledContext = {
      paymentPayload,
      requirements,
      reason: options.reason,
      error: options.error,
      responseStatus: options.responseStatus,
    };
    for (const [index, hook] of onVerifiedPaymentCanceledHooks.entries()) {
      try {
        await hook(context);
      } catch (err) {
        warnHookFailure(
          'GatewayMiddleware',
          'onVerifiedPaymentCanceled',
          `manual hook #${index}`,
          err,
        );
      }
    }
  }

  // ==========================================================================
  // Middleware
  // ==========================================================================

  const api: GatewayMiddleware = {
    require: (price: string): MiddlewareFunction => {
      const routeConfig: ProtectedRouteConfig = { price };
      return async (req, res, next) => {
        try {
          // ----- onProtectedRequest --------------------------------------
          const requestContext = buildProtectedRequestContext(req);
          for (const [index, hook] of protectedRequestHooks.entries()) {
            try {
              const result = await hook(requestContext, routeConfig);
              if (result && 'grantAccess' in result && result.grantAccess) {
                next();
                return;
              }
              if (result && 'abort' in result && result.abort) {
                res.statusCode = 403;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: result.reason }));
                return;
              }
            } catch (err) {
              warnHookFailure(
                'GatewayMiddleware',
                'onProtectedRequest',
                `manual hook #${index}`,
                err,
              );
            }
          }

          // Check for payment header
          const paymentHeader = req.headers['payment-signature'] as string | undefined;

          if (!paymentHeader) {
            // Return 402 Payment Required with all accepted networks
            const allRequirements = await createAllPaymentRequirements(price);
            const url = req.url ?? '/';
            const description = config.description ?? 'Paid resource';

            if (allRequirements.length === 0) {
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'No payment networks available' }));
              return;
            }

            const paymentRequired = {
              x402Version: 2, // Version 2 required by Gateway API
              resource: {
                url,
                description,
                mimeType: 'application/json',
              },
              accepts: allRequirements,
            };

            // x402 v2: Payment required info goes in PAYMENT-REQUIRED header (base64-encoded)
            const paymentRequiredHeader = Buffer.from(
              JSON.stringify(paymentRequired),
            ).toString('base64');

            res.statusCode = 402;
            res.setHeader('PAYMENT-REQUIRED', paymentRequiredHeader);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({}));
            return;
          }

          // Decode payment
          const paymentPayload = JSON.parse(
            Buffer.from(paymentHeader, 'base64').toString('utf-8'),
          );
          const acceptedRequirements = paymentPayload.accepted as
            | PaymentRequirements
            | undefined;

          if (!acceptedRequirements?.network) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({ error: 'Missing accepted requirements in payment' }),
            );
            return;
          }

          // Create requirements for the network the buyer chose
          const requirements = await createPaymentRequirements(
            price,
            acceptedRequirements.network,
          );

          if (!requirements) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: `Network ${acceptedRequirements.network} not accepted`,
              }),
            );
            return;
          }

          // ----- verify lifecycle ----------------------------------------
          const verify = await runVerifyLifecycle(paymentPayload, requirements);

          if (verify.kind === 'aborted') {
            res.statusCode = 402;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Payment verification aborted',
                reason: verify.reason,
                ...(verify.message ? { message: verify.message } : {}),
              }),
            );
            return;
          }

          if (verify.kind === 'failed') {
            res.statusCode = 402;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Payment verification failed',
                reason: verify.result.invalidReason,
              }),
            );
            return;
          }

          if (verify.kind === 'thrown') {
            throw verify.error;
          }

          const verifyResult = verify.result;
          const skipHandlerDirective = verify.skipHandler;

          // ----- settle lifecycle ----------------------------------------
          const settle = await runSettleLifecycle(paymentPayload, requirements);

          if (settle.kind === 'aborted') {
            await dispatchVerifiedPaymentCanceled(paymentPayload, requirements, {
              reason: 'handler_failed',
              responseStatus: 402,
            });
            res.statusCode = 402;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Payment settlement aborted',
                reason: settle.reason,
                ...(settle.message ? { message: settle.message } : {}),
              }),
            );
            return;
          }

          if (settle.kind === 'thrown') {
            await dispatchVerifiedPaymentCanceled(paymentPayload, requirements, {
              reason: 'handler_failed',
              error: settle.error,
              responseStatus: 402,
            });
            throw settle.error;
          }

          const settleResult = settle.result;

          if (!settleResult.success) {
            await dispatchVerifiedPaymentCanceled(paymentPayload, requirements, {
              reason: 'handler_failed',
              responseStatus: 402,
            });
            res.statusCode = 402;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Payment settlement failed',
                reason: settleResult.errorReason,
              }),
            );
            return;
          }

          // Attach payment info to request
          req.payment = {
            verified: true,
            payer: settleResult.payer ?? verifyResult.payer ?? '',
            amount: parsePrice(price),
            network: requirements.network,
            transaction: settleResult.transaction,
          };

          // x402 v2: Settlement response goes in PAYMENT-RESPONSE header (base64-encoded)
          const settleResponseHeader = Buffer.from(
            JSON.stringify({
              success: true,
              transaction: settleResult.transaction,
              network: requirements.network,
              payer: settleResult.payer ?? verifyResult.payer ?? '',
            }),
          ).toString('base64');
          res.setHeader('PAYMENT-RESPONSE', settleResponseHeader);

          // If a verify hook requested the protected handler be skipped, write
          // a 200 response now and bypass `next()`. Mirrors x402HTTPResourceServer's
          // processSkipHandlerSettlement.
          if (skipHandlerDirective) {
            const contentType = skipHandlerDirective.contentType ?? 'application/json';
            const body = skipHandlerDirective.body ?? {};
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            res.end(typeof body === 'string' ? body : JSON.stringify(body));
            return;
          }

          // Hand off to protected handler. If it throws synchronously, treat
          // it as a verified-payment-canceled scenario.
          try {
            await Promise.resolve(next());
          } catch (handlerError) {
            await dispatchVerifiedPaymentCanceled(paymentPayload, requirements, {
              reason: 'handler_threw',
              error: handlerError,
            });
            throw handlerError;
          }
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: 'Payment processing error',
              message: (error as Error).message,
            }),
          );
        }
      };
    },

    verify: async (payment) => {
      try {
        const paymentPayload = payment as {
          paymentPayload: unknown;
          paymentRequirements: PaymentRequirements;
        };
        const result = await facilitator.verify(
          paymentPayload.paymentPayload as Parameters<typeof facilitator.verify>[0],
          paymentPayload.paymentRequirements,
        );
        return {
          valid: result.isValid,
          payer: result.payer,
          error: result.invalidReason,
        };
      } catch (error) {
        return {
          valid: false,
          error: (error as Error).message,
        };
      }
    },

    settle: async (payment) => {
      try {
        const paymentPayload = payment as {
          paymentPayload: unknown;
          paymentRequirements: PaymentRequirements;
        };
        const result = await facilitator.settle(
          paymentPayload.paymentPayload as Parameters<typeof facilitator.settle>[0],
          paymentPayload.paymentRequirements,
        );
        return {
          success: result.success,
          transaction: result.transaction,
          error: result.errorReason,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },

    onProtectedRequest: (hook) => {
      protectedRequestHooks.push(hook);
      return api;
    },
    onBeforeVerify: (hook) => {
      beforeVerifyHooks.push(hook);
      return api;
    },
    onAfterVerify: (hook) => {
      afterVerifyHooks.push(hook);
      return api;
    },
    onVerifyFailure: (hook) => {
      onVerifyFailureHooks.push(hook);
      return api;
    },
    onBeforeSettle: (hook) => {
      beforeSettleHooks.push(hook);
      return api;
    },
    onAfterSettle: (hook) => {
      afterSettleHooks.push(hook);
      return api;
    },
    onSettleFailure: (hook) => {
      onSettleFailureHooks.push(hook);
      return api;
    },
    onVerifiedPaymentCanceled: (hook) => {
      onVerifiedPaymentCanceledHooks.push(hook);
      return api;
    },
  };

  return api;
}
