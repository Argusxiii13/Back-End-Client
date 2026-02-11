const nodemailer = require("nodemailer");
const dotenv = require('dotenv');
dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true'; // Convert to boolean
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

function generateEmailHTML(options) {
  const { subject, content, senderInitial, senderEmail } = options;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; border: 1px solid #ddd; }
        .header { background-color: #f4f4f4; padding: 10px 20px; border-bottom: 1px solid #ddd; }
        .content { padding: 20px; }
        .sender { display: flex; align-items: center; margin-bottom: 15px; }
        .sender-initial { width: 40px; height: 40px; background-color: #007bff; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold; }
        .sender-info { font-size: 14px; color: #666; }
        .footer { background-color: #f4f4f4; padding: 10px 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2 style="margin: 0; color: #444;">${subject}</h2>
        </div>
        <div class="content">
          <div class="sender">
            <div class="sender-initial">${senderInitial}</div>
            <div class="sender-info">
              <div>${senderEmail}</div>
              <div>to me</div>
            </div>
          </div>
          ${content}
        </div>
        <div class="footer">
          <p>This is an automated message from Autoconnect. Please do not reply to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

async function verifyCaptcha(solution) {
    try {
        const response = await fetch('https://api.friendlycaptcha.com/api/v1/siteverify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                solution: solution,
                secret: process.env.FRIENDLY_CAPTCHA_SECRET,
                sitekey: 'FCMGR12NTIE60LB9',
            }),
        });

        const data = await response.json();
        console.log('Captcha verification response:', data);
        return data;
    } catch (error) {
        console.error('Error verifying captcha:', error);
        return { success: false, errors: ['Failed to verify captcha'] };
    }
}

const sendEmailHandler = async (req, res) => {
    console.log('Received request:', req.body);
    
    if (req.method !== 'POST') {
        console.log(`Method not allowed: ${req.method}`);
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { name, email, phone, inquiry, captchaSolution } = req.body;

    if (!captchaSolution) {
        console.log('Captcha solution is missing.');
        return res.status(400).json({ message: 'Captcha solution is required' });
    }

    try {
        // Verify captcha solution
        const captchaVerification = await verifyCaptcha(captchaSolution);
        console.log('Captcha verification response:', captchaVerification);

        if (!captchaVerification.success) {
            console.error('Captcha verification failed:', captchaVerification.errors);
            return res.status(400).json({ message: 'Captcha verification failed', details: captchaVerification.errors });
        }

        // Set up Nodemailer
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });

        // Email options for the inquiry
        const inquiryMailOptions = {
            from: SMTP_USER,
            to: SMTP_USER, // Send to the same address as SMTP_USER
            subject: `New Inquiry from ${name}`,
            html: generateEmailHTML({
                subject: `New Inquiry from ${name}`,
                content: `
                    <p>You have a new inquiry from:</p>
                    <p><strong>Name:</strong> ${name}</p>
                    <p><strong>Email:</strong> ${email}</p>
                    <p><strong>Phone:</strong> ${phone}</p>
                    <p><strong>Inquiry:</strong> ${inquiry}</p>
                `,
                senderInitial: name.charAt(0).toUpperCase(),
                senderEmail: email,
            }),
        };

        // Send the inquiry email
        await transporter.sendMail(inquiryMailOptions);
        console.log('Inquiry email sent successfully');

        // Email options for the confirmation message
        const confirmationMailOptions = {
            from: SMTP_USER,
            to: email, // The user's email address
            subject: 'Inquiry Received - Autoconnect',
            html: generateEmailHTML({
                subject: 'Inquiry Received',
                content: `
                    <p>Dear ${name},</p>
                    <p>Your inquiry has been received by Autoconnect. We appreciate your interest and will review your message promptly.</p>
                    <p>Please wait for further reply from our team. We aim to respond to all inquiries within 24-48 hours.</p>
                    <p>Thank you for choosing Autoconnect.</p>
                `,
                senderInitial: 'A',
                senderEmail: SMTP_USER,
            }),
        };

        // Send the confirmation email
        await transporter.sendMail(confirmationMailOptions);
        console.log('Confirmation email sent successfully');

        // Send success response
        res.status(200).json({ message: 'Inquiry sent and confirmation email sent successfully' });
    } catch (error) {
        console.error('Error in send-email:', error);
        return res.status(500).json({ message: 'Failed to send email', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
};

module.exports = sendEmailHandler;