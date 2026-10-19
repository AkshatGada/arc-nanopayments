export { n as AfterPaymentCreationHook, h as AfterSettleHook, A as AfterVerifyHook, l as BatchEvmSigner, t as BatchExtra, B as BatchFacilitatorConfig, k as BatchPayload, m as BeforePaymentCreationHook, g as BeforeSettleHook, f as BeforeVerifyHook, C as CIRCLE_BATCHING_NAME, s as CIRCLE_BATCHING_SCHEME, r as CIRCLE_BATCHING_VERSION, d as FacilitatorAfterSettleHook, a as FacilitatorAfterVerifyHook, c as FacilitatorBeforeSettleHook, F as FacilitatorBeforeVerifyHook, e as FacilitatorOnSettleFailureHook, b as FacilitatorOnVerifyFailureHook, G as GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS, H as HookPaymentPayload, v as HookPaymentRequired, u as HookPaymentRequirements, x as HookSettleResponse, w as HookVerifyResponse, o as OnPaymentCreationFailureHook, p as OnPaymentResponseHook, i as OnSettleFailureHook, j as OnVerifiedPaymentCanceledHook, O as OnVerifyFailureHook, N as PaymentCreatedContext, M as PaymentCreationContext, Q as PaymentCreationFailureContext, q as PaymentResponseContext, K as ProtectedRequestContext, P as ProtectedRequestHook, L as ProtectedRouteConfig, S as SettleContext, E as SettleFailureContext, D as SettleResultContext, T as TransferWithAuthorizationMessage, I as VerifiedPaymentCanceledContext, J as VerifiedPaymentCancellationReason, V as VerifyContext, z as VerifyFailureContext, y as VerifyResultContext } from './hooks-BKkPP7ic.js';
import 'viem';

/**
 * PaymentRequirements-like structure for detection.
 * We only need the `extra` field to detect batching options.
 */
interface PaymentRequirementsLike {
    extra?: Record<string, unknown>;
}
/**
 * Check if a PaymentRequirements object supports batched settlement.
 *
 * Batching options are identified by:
 * - `extra.name === "GatewayWalletBatched"`
 * - `extra.version === "1"`
 *
 * @param requirements - The payment requirements to check
 * @returns true if this supports batched settlement
 *
 * @example
 * ```typescript
 * import { supportsBatching } from "@circle-fin/x402-batching";
 *
 * if (supportsBatching(paymentRequirements)) {
 *   // This option uses batched settlement (gas-free for users!)
 * }
 * ```
 */
declare function supportsBatching(requirements: PaymentRequirementsLike): boolean;
/**
 * Check if a PaymentRequirements object is a batched payment.
 *
 * This is an alias for `supportsBatching`, intended for server-side/facilitator use.
 * Use this to route payments to the appropriate handler.
 *
 * @param requirements - The payment requirements to check
 * @returns true if this is a batched payment
 *
 * @example
 * ```typescript
 * import { isBatchPayment, BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
 *
 * const gateway = new BatchFacilitatorClient();
 *
 * // In your facilitator's verify/settle handler:
 * if (isBatchPayment(requirements)) {
 *   return gateway.verify(payload, requirements);
 * }
 * // else: handle with existing on-chain logic
 * ```
 */
declare const isBatchPayment: typeof supportsBatching;
/**
 * Get the verifyingContract address from batching requirements.
 *
 * @param requirements - The payment requirements
 * @returns The batch wallet contract address, or undefined if not a batching option
 */
declare function getVerifyingContract(requirements: PaymentRequirementsLike): string | undefined;

export { getVerifyingContract, isBatchPayment, supportsBatching };
