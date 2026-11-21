import { m } from "../../../../i18n/messages";
import { msg } from "gt-react";
const messages: Record<string, string> = {
  "account.login.connectingTitle": m(msg("Connecting to OpenBot")),
  "account.login.unavailableTitle": m(msg("Service unavailable")),
  "account.login.signedInTitle": m(msg("You’re signed in")),
  "account.login.checkInboxTitle": m(msg("Check your inbox")),
  "account.login.signInTitle": m(msg("Sign in to OpenBot")),
  "account.login.connectingDescription": m(
    msg("Starting the account service. This usually takes a moment."),
  ),
  "account.login.unavailableDescription": m(
    msg("OpenBot can’t reach the account service right now."),
  ),
  "account.login.signInDescription": m(
    msg("Use your email to sign in or create an account. We’ll send you a one-time code."),
  ),
  "account.login.codeAccepted": "Your code was accepted.",
  "account.login.codeSent": "We sent a code to {email}.",
  "account.login.connectingSecurely": "Connecting securely…",
  "account.login.email": "Email",
  "account.login.emailRequired": "Enter your email address.",
  "account.login.emailInvalid": "Enter a valid email address.",
  "account.login.checkDelivery": "Check delivery",
  "account.login.checkAgainIn": "Check again in {time}",
  "account.login.sendCode": "Send sign-in code",
  "account.login.tryAgainIn": "Try again in {time}",
  "account.login.checkingDelivery": "Checking delivery…",
  "account.login.sendingCode": "Sending code…",
  "account.login.localData": "Your chats and files stay on the computer that runs OpenBot.",
  "account.login.sendFailed": "Something went wrong while sending the code. Try again.",
  "account.login.codeIncomplete": "Enter the full 8-character code.",
  "account.login.verifyFailed": "Something went wrong while verifying the code. Try again.",
  "account.login.resendFailed": "Something went wrong while sending a new code. Try again.",
  "account.login.stillUnreachable": "OpenBot still can’t reach the account service.",
  "account.login.resetFailed": "OpenBot couldn’t restart sign in. Try again.",
  "account.login.codeHint": m(msg("Enter all 8 characters to continue.")),
  "account.login.verified": "Verified. Opening OpenBot…",
  "account.login.developmentCode": "Development code: {code}",
  "account.login.sendNewCode": "Send a new code",
  "account.login.sendNewCodeIn": "Send a new code in {time}",
  "account.login.sendingNewCode": "Sending new code…",
  "account.login.changeEmail": "Change email",
  "account.login.resend": "Resend code",
  "account.login.resendIn": "Resend in {time}",
  "account.login.loadFailed": "OpenBot could not load the account service.",
  "account.login.companyTitle": m(msg("Continue in your browser")),
  "account.login.companyDescription": m(
    msg(
      "'{'email'}' signs in with a company account. Finish signing in on the page that opened in your browser.",
    ),
  ),
  "account.login.companyWaiting": "Waiting for your browser…",
  "account.login.companyOpenAgain": "Open the sign-in page again",
  "account.login.companyOpening": "Opening…",
  "account.login.companyUseAnotherEmail": "Use another email",
  "account.login.companyOpenFailed": "OpenBot couldn’t open the sign-in page. Try again.",
  "account.otp.incorrect": "That code is incorrect. Try again.",
  "account.otp.verifying": "Verifying…",
  "account.otp.entry": "One-time code entry",
  "account.otp.label": "One-time code",
};
export function accountText(key: string, params: Record<string, string | number> = {}) {
  return (messages[key] ?? key).replace(/\{([^}]+)\}/g, (_, name: string) =>
    String(params[name] ?? `{${name}}`),
  );
}
