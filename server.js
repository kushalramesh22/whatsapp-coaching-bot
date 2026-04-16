/**
 * WhatsApp Business Chatbot for Sports Coaching Academy
 *
 * Handles customer enquiries, shares batch info, collects leads,
 * and logs them to Google Sheets with auto-tagging.
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ============================================================
// ENVIRONMENT VARIABLES (set these in Render dashboard)
// ============================================================
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;           // You make this up - any random string
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;       // From Meta Developer dashboard
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;     // From Meta Developer dashboard
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL; // From Google Apps Script
const ACADEMY_NAME = process.env.ACADEMY_NAME || 'our Academy';

// ============================================================
// BATCH INFO - FILL IN YOUR ACTUAL TIMINGS AND PRICING HERE
// ============================================================
const BATCH_INFO = {
  badminton_kids: {
    timings: [
      'Mon / Wed / Fri — 5:00 to 6:30 PM',
      'Tue / Thu / Sat — 6:30 to 8:00 PM'
    ],
    pricing: '₹[FILL PRICE]/month'
  },
  badminton_adults: {
    timings: [
      '[FILL TIMING 1]',
      '[FILL TIMING 2]'
    ],
    pricing: '₹[FILL PRICE]/month'
  },
  swimming_kids: {
    timings: [
      '[FILL TIMING 1]',
      '[FILL TIMING 2]'
    ],
    pricing: '₹[FILL PRICE]/month'
  },
  swimming_adults: {
    timings: [
      '[FILL TIMING 1]',
      '[FILL TIMING 2]'
    ],
    pricing: '₹[FILL PRICE]/month'
  }
};

// ============================================================
// IN-MEMORY STATE (tracks where each user is in the conversation)
// ============================================================
const userStates = new Map();

// Auto-reset a conversation if user is idle for 30 min
const RESET_AFTER_MS = 30 * 60 * 1000;

function getState(phone) {
  const existing = userStates.get(phone);
  if (existing && Date.now() - existing.lastActive < RESET_AFTER_MS) {
    return existing;
  }
  const fresh = { step: 'start', data: {}, lastActive: Date.now() };
  userStates.set(phone, fresh);
  return fresh;
}

function saveState(phone, state) {
  state.lastActive = Date.now();
  userStates.set(phone, state);
}

function clearState(phone) {
  userStates.delete(phone);
}

// ============================================================
// WEBHOOK VERIFICATION (Meta calls this once during setup)
// ============================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================================
// WEBHOOK MESSAGE HANDLER (Meta calls this for every incoming message)
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately so Meta doesn't retry

  try {
    const entry = req.body.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = message.from;
    let text = '';

    if (message.type === 'text') {
      text = message.text.body;
    } else if (message.type === 'interactive') {
      text = message.interactive.button_reply?.title
          || message.interactive.list_reply?.title
          || '';
    } else {
      text = '';
    }

    await handleMessage(from, text.trim());
  } catch (err) {
    console.error('Error handling message:', err.message);
  }
});

// ============================================================
// CONVERSATION FLOW
// ============================================================
async function handleMessage(from, text) {
  const state = getState(from);
  const lower = text.toLowerCase();

  // Global "restart" command
  if (lower === 'restart' || lower === 'reset') {
    clearState(from);
    await sendText(from, 'Conversation reset. Say hi to start again!');
    return;
  }

  switch (state.step) {
    case 'start': {
      await sendText(
        from,
        `Hi! 👋 Welcome to ${ACADEMY_NAME}.\n\nMay I know your name, please?`
      );
      state.step = 'awaiting_name';
      break;
    }

    case 'awaiting_name': {
      state.data.name = text;
      await sendButtons(
        from,
        `Nice to meet you, ${text}! 🙂\n\nWhat are you interested in?`,
        ['Badminton', 'Swimming']
      );
      state.step = 'awaiting_sport';
      break;
    }

    case 'awaiting_sport': {
      if (lower.includes('badminton')) {
        state.data.sport = 'badminton';
      } else if (lower.includes('swimming') || lower.includes('swim')) {
        state.data.sport = 'swimming';
      } else {
        await sendButtons(from, 'Please pick one:', ['Badminton', 'Swimming']);
        break;
      }
      await sendButtons(
        from,
        'Got it! Is the coaching for:',
        ['Kids', 'Adults']
      );
      state.step = 'awaiting_age';
      break;
    }

    case 'awaiting_age': {
      if (lower.includes('kid') || lower.includes('child')) {
        state.data.ageGroup = 'kids';
      } else if (lower.includes('adult')) {
        state.data.ageGroup = 'adults';
      } else {
        await sendButtons(from, 'Please pick one:', ['Kids', 'Adults']);
        break;
      }

      const key = `${state.data.sport}_${state.data.ageGroup}`;
      const info = BATCH_INFO[key];
      const sportLabel = cap(state.data.sport);
      const ageLabel = cap(state.data.ageGroup);

      const batchMsg =
        `Here are our ${ageLabel} ${sportLabel} batches:\n\n` +
        info.timings.map(t => `• ${t}`).join('\n') +
        `\n\n💰 ${info.pricing}`;

      await sendText(from, batchMsg);
      await sendButtons(
        from,
        'Would you like to try a free trial class before deciding?',
        ['Book Trial', 'More Info', 'Not Interested']
      );
      state.step = 'awaiting_decision';
      break;
    }

    case 'awaiting_decision': {
      if (lower.includes('trial') || lower.includes('book')) {
        state.data.status = 'Trial';
        await sendText(
          from,
          'Great choice! 🎉\n\nPlease share your preferred date and time for the trial class (e.g., "Saturday 6 PM").'
        );
        state.step = 'awaiting_trial_date';
      } else if (lower.includes('info') || lower.includes('more')) {
        state.data.status = 'Interested';
        await sendText(
          from,
          'Sure! A coach from our team will reach out to you shortly with more details. Thanks for your interest! 🙏'
        );
        await logLead(from, state.data);
        clearState(from);
      } else if (lower.includes('not') || lower.includes('no')) {
        state.data.status = 'Not Interested';
        await sendText(
          from,
          'No problem! Feel free to reach out anytime in the future. Have a great day! 😊'
        );
        await logLead(from, state.data);
        clearState(from);
      } else {
        await sendButtons(
          from,
          'Please pick one:',
          ['Book Trial', 'More Info', 'Not Interested']
        );
      }
      break;
    }

    case 'awaiting_trial_date': {
      state.data.trialDate = text;
      await sendText(
        from,
        `Awesome! ✅\n\nYour trial is noted for: *${text}*\n\nOur coach will confirm the exact slot with you shortly. See you soon! 🏸🏊`
      );
      await logLead(from, state.data);
      clearState(from);
      break;
    }
  }

  if (userStates.has(from)) saveState(from, state);
}

// ============================================================
// WHATSAPP CLOUD API HELPERS
// ============================================================
async function sendText(to, body) {
  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('sendText failed:', err.response?.data || err.message);
  }
}

async function sendButtons(to, body, buttonLabels) {
  // WhatsApp allows max 3 buttons, max 20 chars each
  const buttons = buttonLabels.slice(0, 3).map((label, i) => ({
    type: 'reply',
    reply: { id: `btn_${i}`, title: label.slice(0, 20) }
  }));

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: { buttons }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('sendButtons failed:', err.response?.data || err.message);
  }
}

// ============================================================
// GOOGLE SHEETS LOGGING (via Apps Script webhook)
// ============================================================
async function logLead(phone, data) {
  if (!SHEETS_WEBHOOK_URL) {
    console.log('No Sheets URL configured. Lead:', { phone, ...data });
    return;
  }

  try {
    await axios.post(SHEETS_WEBHOOK_URL, {
      timestamp: new Date().toISOString(),
      phone,
      name: data.name || '',
      sport: data.sport || '',
      ageGroup: data.ageGroup || '',
      status: data.status || '',
      trialDate: data.trialDate || ''
    });
    console.log('Logged lead:', phone, data.status);
  } catch (err) {
    console.error('logLead failed:', err.message);
  }
}

// ============================================================
// UTILITIES
// ============================================================
function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Health check - useful for UptimeRobot to ping and keep server awake
app.get('/', (_req, res) => res.send('Bot is running 🚀'));

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
