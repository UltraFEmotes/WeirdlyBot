export function videoApiError(status, detail, retryHint = "") {
  const message = String(detail || "").slice(0, 300);
  const error = new Error(`Video API error ${status || "unknown"}${retryHint}: ${message}`);
  error.videoStatus = status;
  error.upstreamRejected = /(?:proveedor de google rechaz[oó] la solicitud|google(?:'s)? (?:provider|upstream) rejected the request)/i.test(message);
  return error;
}

export function videoFailureMessage(error) {
  if (error.upstreamRejected) {
    return "Flama says its video provider rejected the request without giving a reason. That doesn't confirm the prompt was blocked.";
  }
  if (error.videoStatus === 400) return "Flama rejected the video request (HTTP 400). It didn't confirm whether the prompt or settings were the issue.";
  if (error.videoStatus === 429) return "Flama's video service is rate-limited. Try again later.";
  if (error.videoStatus >= 500) return "Flama's video service is having trouble. Try again later.";
  if (error.videoStatus === 401 || error.videoStatus === 403) return "Flama didn't authorize video generation. Check the API key and its permissions.";
  if (error instanceof MediaDeliveryError) return "The video was generated, but I couldn't deliver it.";
  if (error.message?.startsWith("video too large")) return "The video was generated, but it's too large to upload to Discord.";
  return "Couldn't generate the video.";
}
import { MediaDeliveryError } from "./MediaDelivery.js";
