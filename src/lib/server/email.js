import { RESEND_API_KEY } from '$env/static/private';
import { Resend } from 'resend';

let resend;
function getResend() {
	if (!resend) resend = new Resend(RESEND_API_KEY);
	return resend;
}

export async function sendApprovalEmail({ toEmail, toName, className, term }) {
	if (!RESEND_API_KEY) return;
	await getResend().emails.send({
		from: 'eating.computer <noreply@eating.computer>',
		to: toEmail,
		subject: `You've been approved — ${className}`,
		html: `
			<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
				<h1 style="font-size: 1.5rem; margin-bottom: 0.5rem;">You're in! 🎉</h1>
				<p style="color: #555;">Hi ${toName},</p>
				<p style="color: #555;">Your request to join <strong>${className}</strong> (${term}) has been approved. Head over to eating.computer to get started.</p>
				<a href="https://eating.computer/app" style="display:inline-block;margin-top:1rem;padding:0.6rem 1.4rem;background:#1a1a1a;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;">Open eating.computer</a>
				<p style="margin-top:2rem;font-size:0.8rem;color:#aaa;">eating.computer</p>
			</div>
		`
	});
}
