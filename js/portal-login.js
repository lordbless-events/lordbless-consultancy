"use strict";

/*
 * LORDBLESS portal login
 *
 * Requires the page to provide `lordblessSupabase` before this script runs.
 * This file intentionally does not initialize a new Supabase client because
 * the supplied source did not include the URL, key, or client setup.
 *
 * Business rules:
 * - Accepting an invitation or setting a password does not activate a client.
 * - activation_required enters limited onboarding; active enters full portal access.
 * - Invited clients are shown the password setup form.
 * - The Edge Function is not changed by this script.
 */

const portalLoginForm = document.getElementById("portal-login-form");
const portalEmailInput = document.getElementById("portal-email");
const portalPasswordInput = document.getElementById("portal-password");
const portalForgotPasswordButton = document.getElementById("portal-forgot-password");
const portalRecoveryForm = document.getElementById("portal-recovery-form");
const portalRecoveryEmailInput = document.getElementById("portal-recovery-email");
const portalRecoveryBackButton = document.getElementById("portal-recovery-back");
const portalResetPasswordForm = document.getElementById("portal-reset-password-form");
const portalNewPasswordInput = document.getElementById("portal-new-password");
const portalConfirmPasswordInput = document.getElementById("portal-confirm-password");
const portalAuthMessage = document.getElementById("portal-auth-message");
const portalAuthEyebrow = document.getElementById("portal-auth-eyebrow");
const portalLoginTitle = document.getElementById("portal-login-title");
const portalLoginDescription = document.getElementById("portal-login-description");
const portalSetupEmailInput = document.getElementById("portal-setup-email");
const portalResetPasswordSubmit = document.getElementById("portal-reset-password-submit");
const portalNewPasswordLabel = document.getElementById("portal-new-password-label");
const portalConfirmPasswordLabel = document.getElementById("portal-confirm-password-label");
const portalSignOutButton = document.getElementById("portal-sign-out");
const portalSignInButton = portalLoginForm.querySelector('[type="submit"]');

let portalRedirectStarted = false;
let portalResolutionVersion = 0;
let portalResetMode = false;
let portalPasswordResetComplete = false;
let portalRecoveryEmail = "";
let portalAuthInitializationComplete = false;
let portalPendingAuthEvent = null;

const recoveryHashParams = new URLSearchParams(window.location.hash.slice(1));
const recoveryQueryParams = new URLSearchParams(window.location.search);
const authCallback = window.LORDBLESS_AUTH_CALLBACK || {};
const authLinkType = authCallback.type || recoveryHashParams.get("type") || recoveryQueryParams.get("type");
const authTokenHash = authCallback.tokenHash || recoveryHashParams.get("token_hash") || recoveryQueryParams.get("token_hash");
const authCode = authCallback.code || recoveryQueryParams.get("code");
const authCallbackError = Boolean(authCallback.error || recoveryQueryParams.get("error") || recoveryHashParams.get("error"));
const isInviteLink = authLinkType === "invite";
const isRecoveryLink = authLinkType === "recovery";

function initializePortalUi() {
    portalLoginForm.hidden = true;
    portalForgotPasswordButton.hidden = true;
    portalRecoveryForm.hidden = true;
    portalResetPasswordForm.hidden = true;
    portalSignOutButton.hidden = true;
    portalSignInButton.disabled = false;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Sign in with your LORDBLESS account.";
}

function showPasswordResetForm(session, mode = "recovery") {
    // Stop any in-flight portal access check before showing password setup.
    portalResolutionVersion++;
    portalResetMode = true;
    portalPasswordResetComplete = false;
    portalRecoveryEmail = session?.user?.email || portalRecoveryEmail;
    const isInvitation = mode === "invite";

    if (session?.user?.email) {
        portalEmailInput.value = session.user.email;
        portalSetupEmailInput.value = session.user.email;
    }

    portalAuthEyebrow.textContent = isInvitation ? "CLIENT ACCOUNT SETUP" : "PASSWORD RECOVERY";
    portalLoginTitle.textContent = isInvitation ? "Create your portal account" : "Update your password";
    portalLoginDescription.textContent = isInvitation
        ? "Confirm your registered email and create a password to activate your Client Portal access."
        : "Create a new password for your LORDBLESS account.";
    portalNewPasswordLabel.textContent = isInvitation ? "Create password" : "New password";
    portalConfirmPasswordLabel.textContent = isInvitation ? "Confirm password" : "Confirm new password";
    portalNewPasswordInput.autocomplete = "new-password";
    portalResetPasswordSubmit.textContent = isInvitation ? "Create Account" : "Update Password";
    portalLoginForm.hidden = true;
    portalForgotPasswordButton.hidden = true;
    portalRecoveryForm.hidden = true;
    portalResetPasswordForm.hidden = false;
    portalSignOutButton.hidden = true;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Set a new password for your LORDBLESS account.";
}

function showPortalLogin(message) {
    portalResetMode = false;
    portalLoginForm.hidden = false;
    portalForgotPasswordButton.hidden = false;
    portalRecoveryForm.hidden = true;
    portalResetPasswordForm.hidden = true;
    portalSignOutButton.hidden = true;
    portalSignInButton.disabled = false;
    portalAuthEyebrow.textContent = "CLIENT & ADMIN LOGIN";
    portalLoginTitle.textContent = "LORDBLESS Portal";
    portalLoginDescription.textContent = "Sign in with your LORDBLESS account to continue to your portal.";
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = message;
}

async function routePortalRole(role, clientAccessStatus = "active") {
    if (portalRedirectStarted || !["admin", "client"].includes(role)) return;
    portalRedirectStarted = true;

    let destination = role === "admin" ? "admin/index.html" : "";

    if (role === "client") {
        try {
            const decision = await window.LORDBLESS_CLIENT_PORTAL_ROUTING?.resolve(clientAccessStatus);
            destination = decision?.destination === "autos" ? "autos-portal.html" : "client/index.html";
        } catch (error) {
            console.warn("Client portal routing check unavailable:", error?.message || error);
            destination = "client/index.html";
        }
    }

    if (!destination) {
        portalRedirectStarted = false;
        return;
    }
    window.location.assign(destination);
}

async function resolvePortalAccess(user) {
    const [staffResult, clientResult] = await Promise.all([
        lordblessSupabase
            .from("staff_profiles")
            .select("user_id, active")
            .eq("user_id", user.id)
            .maybeSingle(),
        lordblessSupabase
            .from("client_accounts")
            .select("auth_user_id, client_id, access_status")
            .eq("auth_user_id", user.id)
            .maybeSingle()
    ]);

    if (staffResult.error) throw staffResult.error;
    if (clientResult.error) throw clientResult.error;

    const staff = staffResult.data;
    const client = clientResult.data;

    if (staff && client) {
        throw new Error("This account has conflicting staff and client access. Contact LORDBLESS support.");
    }

    if (staff?.active) return { portal: "admin" };

    if (client) {
        if (client.access_status === "active") return { portal: "client", accessStatus: client.access_status };
        if (client.access_status === "activation_required") return { portal: "client", accessStatus: client.access_status };
        if (client.access_status === "invited") return { invited: true };

        const status = String(client.access_status || "unknown").replaceAll("_", " ");
        return {
            pending: true,
            message: `Your Client Portal access is ${status}. Contact LORDBLESS support if you need assistance.`
        };
    }

    if (staff && !staff.active) {
        throw new Error("This staff account is inactive. Contact LORDBLESS support.");
    }

    throw new Error("Portal access has not been assigned to this account. Contact LORDBLESS support.");
}

async function handlePortalSession(session) {
    if (portalResetMode || portalPasswordResetComplete) return;

    const version = ++portalResolutionVersion;

    if (!session?.user) {
        showPortalLogin("Sign in with your LORDBLESS account.");
        return;
    }

    portalLoginForm.hidden = true;
    portalForgotPasswordButton.hidden = true;
    portalRecoveryForm.hidden = true;
    portalSignOutButton.hidden = false;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Checking your portal access...";

    try {
        const access = await resolvePortalAccess(session.user);
        if (version !== portalResolutionVersion) return;

        if (access.invited) {
            showPasswordResetForm(session, "invite");
            return;
        }

        if (access.pending) {
            portalSignOutButton.hidden = false;
            portalAuthMessage.dataset.error = "true";
            portalAuthMessage.textContent = access.message;
            return;
        }

        if (version !== portalResolutionVersion) return;

        portalAuthMessage.textContent = "Access confirmed. Opening your portal...";
        await routePortalRole(access.portal, access.accessStatus || "active");
    } catch (error) {
        if (version !== portalResolutionVersion) return;
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = error?.message || String(error);
    }
}

portalLoginForm.addEventListener("submit", async event => {
    event.preventDefault();
    portalPasswordResetComplete = false;
    portalSignInButton.disabled = true;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Signing in...";

    try {
        const { data, error } = await lordblessSupabase.auth.signInWithPassword({
            email: portalEmailInput.value.trim(),
            password: portalPasswordInput.value
        });
        if (error) throw error;

        portalPasswordInput.value = "";
        await handlePortalSession(data.session);
        portalSignInButton.disabled = false;
    } catch (error) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = error?.message || String(error);
        portalSignInButton.disabled = false;
    }
});

portalForgotPasswordButton.addEventListener("click", () => {
    portalAuthEyebrow.textContent = "ACCOUNT RECOVERY";
    portalLoginTitle.textContent = "Reset your password";
    portalLoginDescription.textContent = "Enter your registered email to receive a secure password reset link.";
    portalLoginForm.hidden = true;
    portalForgotPasswordButton.hidden = true;
    portalRecoveryForm.hidden = false;
    portalResetPasswordForm.hidden = true;
    portalSignOutButton.hidden = true;
    portalRecoveryEmailInput.value = portalEmailInput.value.trim();
    portalRecoveryEmailInput.focus();
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Enter your email to receive a password reset link.";
});

portalRecoveryBackButton.addEventListener("click", () => {
    showPortalLogin("Sign in with your LORDBLESS account.");
});

portalRecoveryForm.addEventListener("submit", async event => {
    event.preventDefault();
    const recoveryButton = portalRecoveryForm.querySelector('[type="submit"]');
    recoveryButton.disabled = true;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Sending password reset link...";

    try {
        const email = portalRecoveryEmailInput.value.trim();
        const { error } = await lordblessSupabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/portal-login.html`
        });
        if (error) throw error;
        portalAuthMessage.textContent = "If an account exists for that email, a password reset link has been sent.";
    } catch (error) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = error?.message || String(error);
    } finally {
        recoveryButton.disabled = false;
    }
});

portalResetPasswordForm.addEventListener("submit", async event => {
    event.preventDefault();
    const newPassword = portalNewPasswordInput.value;

    if (newPassword.length < 8) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = "Your password must contain at least 8 characters.";
        portalNewPasswordInput.focus();
        return;
    }

    if (newPassword !== portalConfirmPasswordInput.value) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = "The new password and confirmation do not match.";
        portalConfirmPasswordInput.focus();
        return;
    }

    const resetButton = portalResetPasswordForm.querySelector('[type="submit"]');
    resetButton.disabled = true;
    portalAuthMessage.dataset.error = "false";
    portalAuthMessage.textContent = "Updating your password...";

    try {
        const { error } = await lordblessSupabase.auth.updateUser({ password: newPassword });
        if (error) throw error;

        const { data: userResult, error: userError } =
            await lordblessSupabase.auth.getUser();
        if (userError) throw userError;

        if (userResult?.user?.id) {
            const { data: clientAccount, error: accountError } =
                await lordblessSupabase
                    .from("client_accounts")
                    .select("access_status")
                    .eq("auth_user_id", userResult.user.id)
                    .maybeSingle();
            if (accountError) throw accountError;

            if (clientAccount?.access_status === "invited") {
                const { data: activationStatus, error: onboardingError } =
                    await lordblessSupabase.rpc("complete_client_password_setup");
                if (onboardingError) throw onboardingError;
                if (!["activation_required", "active"].includes(activationStatus)) {
                    throw new Error("Your password was saved, but Client Portal activation could not be confirmed. Please contact LORDBLESS support.");
                }

                const { data: sessionResult, error: sessionError } =
                    await lordblessSupabase.auth.getSession();
                if (sessionError) throw sessionError;
                if (sessionResult?.session?.user?.id !== userResult.user.id) {
                    throw new Error("Your password was saved, but your secure session could not be confirmed. Please sign in with your new password.");
                }

                portalNewPasswordInput.value = "";
                portalConfirmPasswordInput.value = "";
                portalPasswordResetComplete = true;
                portalResetMode = false;
                portalAuthMessage.textContent = "Your account is ready. Opening your Client Portal...";
                await routePortalRole("client", activationStatus);
                return;
            }
        }

        // Clear expired invitation/recovery tokens after successful password setup.
window.history.replaceState(
    {},
    document.title,
    window.location.pathname
);

        portalRecoveryEmail = portalRecoveryEmail || portalEmailInput.value.trim();
        let signOutFailed = false;

        try {
            const { error: signOutError } = await lordblessSupabase.auth.signOut();
            signOutFailed = Boolean(signOutError);
        } catch {
            signOutFailed = true;
        }

        portalNewPasswordInput.value = "";
        portalConfirmPasswordInput.value = "";
        if (portalRecoveryEmail) portalEmailInput.value = portalRecoveryEmail;
        portalPasswordInput.value = "";

        // Prevent the auth listener from routing immediately after password setup.
        portalPasswordResetComplete = true;
        const successMessage = "Your password has been updated. You can now sign in with your new password.";
        showPortalLogin(signOutFailed
            ? `${successMessage} If your session remains active, refresh this page before signing in.`
            : successMessage);
    } catch (error) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = error?.message || String(error);
    } finally {
        resetButton.disabled = false;
    }
});

portalSignOutButton.addEventListener("click", async () => {
    portalSignOutButton.disabled = true;

    try {
        const { error } = await lordblessSupabase.auth.signOut();
        if (error) throw error;

        portalPasswordInput.value = "";
        portalSignInButton.disabled = false;
        portalResetMode = false;
        portalPasswordResetComplete = false;
        await handlePortalSession(null);
    } catch (error) {
        portalAuthMessage.dataset.error = "true";
        portalAuthMessage.textContent = error?.message || String(error);
    } finally {
        portalSignOutButton.disabled = false;
    }
});

lordblessSupabase.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;

    if (!portalAuthInitializationComplete) {
        portalPendingAuthEvent = { event, session };
        return;
    }

    if (event === "PASSWORD_RECOVERY") {
        showPasswordResetForm(session, "recovery");
        return;
    }

    if (portalResetMode || portalPasswordResetComplete) return;
    void handlePortalSession(session);
});

async function initializeAuthentication() {
    try {
        if (authCallbackError) {
            portalAuthInitializationComplete = true;
            showPortalLogin("This invitation or password reset link is invalid or has expired. Request a fresh link to continue.");
            portalAuthMessage.dataset.error = "true";
            return;
        }

        let verifiedSession = null;
        // Supabase PKCE invite and recovery links may arrive as `?code=` without
        // a `type` parameter. Treat that callback as password setup so normal
        // role routing cannot win a race with PASSWORD_RECOVERY.
        const isPasswordSetupLink = isInviteLink || isRecoveryLink || Boolean(authCode);

        if (authTokenHash && ["invite", "recovery"].includes(authLinkType)) {
            const { data, error } = await lordblessSupabase.auth.verifyOtp({
                token_hash: authTokenHash,
                type: authLinkType
            });
            if (error) throw error;
            verifiedSession = data?.session || null;
        }

        const { data, error } = await lordblessSupabase.auth.getSession();
        if (error) throw error;
        let session = verifiedSession || data?.session || portalPendingAuthEvent?.session || null;

        // The client SDK handles supported URL hash callbacks during client initialization.
        // If a PKCE code remains without a session, complete the exchange explicitly.
        if (!session && authCode) {
            const { data: exchangeData, error: exchangeError } =
                await lordblessSupabase.auth.exchangeCodeForSession(authCode);
            if (exchangeError) throw exchangeError;
            session = exchangeData?.session || null;
        }

        if (isPasswordSetupLink) {
            if (session?.user) {
                // The callback has now established a session; remove one-time
                // credentials from the address bar before showing the form.
                window.history.replaceState({}, document.title, window.location.pathname);
                let mode = isInviteLink ? "invite" : isRecoveryLink ? "recovery" : null;
                if (!mode && session.user.id) {
                    const { data: clientAccount, error: accountError } = await lordblessSupabase
                        .from("client_accounts")
                        .select("access_status")
                        .eq("auth_user_id", session.user.id)
                        .maybeSingle();
                    if (accountError) throw accountError;
                    mode = clientAccount?.access_status === "invited" ? "invite" : "recovery";
                }
                showPasswordResetForm(session, mode || "recovery");
            } else {
                showPortalLogin("This password setup link is invalid, expired or already used. Request a fresh link to continue.");
            }
            portalAuthInitializationComplete = true;
            return;
        }

        if (portalPendingAuthEvent?.event === "PASSWORD_RECOVERY") {
            if (session?.user) showPasswordResetForm(session, "recovery");
            else showPortalLogin("This password reset link is invalid, expired or already used. Request a fresh link to continue.");
            portalAuthInitializationComplete = true;
            return;
        }

        portalAuthInitializationComplete = true;
        await handlePortalSession(session);
    } catch (error) {
        portalAuthInitializationComplete = true;
        showPortalLogin(error?.message || String(error));
        portalAuthMessage.dataset.error = "true";
    }
}

initializePortalUi();
void initializeAuthentication();
