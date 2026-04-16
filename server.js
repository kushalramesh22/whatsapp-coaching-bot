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
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL;
const ACADEMY_NAME = process.env.ACADEMY_NAME || 'our Academy';

// ============================================================
// BATCH INFO — ALL TIMINGS AND PRICING
// ============================================================
const BATCH_INFO = {

  // ---- SWIMMING ----
  swimming_kids_7_15: {
    label: 'Swimming — Kids (7–15 years)',
    note: '⚠️ Mondays closed for pool maintenance.',
    timings: {
      weekday: [
        '9:15 AM – 10:00 AM',
        '11:30 AM – 12:15 PM',
        '12:15 PM – 1:00 PM (Compensation + Coaching batch)',
        '4:15 PM – 5:00 PM',
        '5:00 PM – 5:45 PM',
        '5:45 PM – 6:30 PM'
      ],
      weekend: [
        '7:45 AM – 8:30 AM',
        '8:30 AM – 9:15 AM',
        '9:15 AM – 10:00 AM',
        '11:30 AM – 12:15 PM',
        '4:15 PM – 5:00 PM',
        '5:00 PM – 5:45 PM'
      ]
    },
    pricing: 'Weekday: ₹5,800/month | Weekend: ₹4,000/month'
  },

  swimming_kids_under_6: {
    label: 'Swimming — Kids (Under 6 years)',
    note: '⚠️ Mondays closed for pool maintenance.',
    timings: {
      weekday: [
        '10:00 AM – 10:45 AM',
        '3:30 PM – 4:15 PM'
      ],
      weekend: [
        '3:30 PM – 4:15 PM'
      ]
    },
    pricing: 'Weekday: ₹6,300/month | Weekend: ₹4,300/month'
  },

  swimming_adults: {
    label: 'Swimming — Adults',
    note: '⚠️ Mondays closed for pool maintenance.',
    timings: {
      weekday: [
        '6:15 AM – 7:00 AM',
        '7:00 AM – 7:45 AM',
        '7:45 AM – 8:30 AM',
        '7:15 PM – 8:00 PM',
        '8:00 PM – 8:45 PM'
      ],
      weekend: [
        '7:00 AM – 7:45 AM',
        '10:00 AM – 10:45 AM (Adults/Kids)',
        '5:45 PM – 6:30 PM (Adults/Kids)'
      ]
    },
    pricing: 'Weekday: ₹5,800/month | Weekend: ₹4,000/month'
  },

  swimming_ladies: {
    label: 'Swimming — Ladies Coaching',
    note: '⚠️ Mondays closed for pool maintenance.',
    timings: {
      weekday: [
        '10:45 AM – 11:30 AM'
      ],
      weekend: [
        '10:45 AM – 11:30 AM'
      ]
    },
    pricing: 'Weekday: ₹5,800/month | Weekend: ₹4,000/month'
  },

  // ---- BADMINTON ----
  badminton_kids: {
    label: 'Badminton — Kids Coaching',
    note: '5 days a week (weekdays). Weekends also available.',
    timings: {
      weekday_morning: [
        '8:00 AM – 9:00 AM (Beginners / Intermediate)',
        '9:00 AM – 10:00 AM (Beginners / Intermediate)'
      ],
      weekday_evening: [
        '4:00 PM – 5:00 PM (Beginners)',
        '5:00 PM – 6:00 PM (Beginners / Intermediate)'
      ],
      compensation: [
        '8:30 AM – 9:15 AM (All weekdays)',
        '6:30 PM – 7:15 PM (Wednesday & Friday)'
      ],
      weekend: [
        '90-minute class on Saturday & Sunday (timings based on availability — courts have corporate bookings 9 AM – 9 PM)'
      ]
    },
    pricing: 'Weekday: Beginners ₹4,000 | Intermediate ₹5,000 | Advanced ₹6,000\nWeekend: ₹2,500 flat (90 mins, both days)'
  },

  badminton_adults: {
    label: 'Badminton — Adults Coaching',
    note: '5 days a week (weekdays). Weekends also available.',
    timings: {
      weekday_morning: [
        '6:00 AM – 7:00 AM',
        '7:00 AM – 8:00 AM'
      ],
      weekday_evening: [
        '6:00 PM – 7:00 PM'
      ],
      compensation: [
        '8:30 AM – 9:15 AM (All weekdays)',
        '6:30 PM – 7:15 PM (Tuesday & Thursday)'
      ],
      weekend: [
        '6:15 AM – 7:00 AM',
        '6:30 PM – 7:15 PM',
        '90-minute class also available on Sat & Sun (timings based on availability)'
      ]
    },
    pricing: 'Weekday: Beginners ₹4,000 | Intermediate ₹5,000 | Advanced ₹6,000\nWeekend: ₹2,500 flat (90 mins, both days)'
  }
};

// ============================================================
// IN-MEMORY STATE
// ============================================================
const userStates = new Map();
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
// WEBHOOK VERIFICATION
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
// WEBHOOK MESSAGE HANDLER
// ============================================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

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

  // Global restart
  if (lower === 'restart' || lower === 'reset' || lower === 'menu' || lower === 'start over') {
    clearState(from);
    const freshState = getState(from);
    await sendText(
      from,
      `Hi! 👋 Welcome to ${ACADEMY_NAME}.\n\nMay I know your name, please?`
    );
    freshState.step = 'awaiting_name';
    saveState(from, freshState);
    return;
  }

  switch (state.step) {

    // ---- STEP 1: Greeting ----
    case 'start': {
      await sendText(
        from,
        `Hi! 👋 Welcome to ${ACADEMY_NAME}.\n\nMay I know your name, please?`
      );
      state.step = 'awaiting_name';
      break;
    }

    // ---- STEP 2: Get name, ask sport ----
    case 'awaiting_name': {
      state.data.name = text;
      await sendButtons(
        from,
        `Nice to meet you, ${text}! 🙂\n\nWhat are you interested in?`,
        ['🏸 Badminton', '🏊 Swimming']
      );
      state.step = 'awaiting_sport';
      break;
    }

    // ---- STEP 3: Get sport, ask category ----
    case 'awaiting_sport': {
      if (lower.includes('badminton')) {
        state.data.sport = 'Badminton';
        await sendButtons(
          from,
          'Great choice! Is the coaching for:',
          ['Kids', 'Adults']
        );
        state.step = 'awaiting_badminton_age';
      } else if (lower.includes('swimming') || lower.includes('swim')) {
        state.data.sport = 'Swimming';
        await sendList(
          from,
          'Got it — Swimming! 🏊\n\nWho is the coaching for?',
          'Select Category',
          [
            { id: 'sw_kids_7_15', title: 'Kids (7–15 years)' },
            { id: 'sw_kids_under_6', title: 'Kids (Under 6)' },
            { id: 'sw_adults', title: 'Adults' },
            { id: 'sw_ladies', title: 'Ladies Coaching' }
          ]
        );
        state.step = 'awaiting_swimming_category';
      } else {
        await sendButtons(from, 'Please pick one:', ['🏸 Badminton', '🏊 Swimming']);
      }
      break;
    }

    // ---- SWIMMING CATEGORY ----
    case 'awaiting_swimming_category': {
      let key = null;
      if (lower.includes('7') || lower.includes('15') || (lower.includes('kid') && !lower.includes('under') && !lower.includes('below'))) {
        key = 'swimming_kids_7_15';
        state.data.category = 'Kids (7–15)';
      } else if (lower.includes('under') || lower.includes('below') || lower.includes('toddler')) {
        key = 'swimming_kids_under_6';
        state.data.category = 'Kids (Under 6)';
      } else if (lower.includes('ladies') || lower.includes('lady') || lower.includes('women')) {
        key = 'swimming_ladies';
        state.data.category = 'Ladies';
      } else if (lower.includes('adult')) {
        key = 'swimming_adults';
        state.data.category = 'Adults';
      }

      if (!key) {
        await sendList(
          from,
          'Please pick one of these:',
          'Select Category',
          [
            { id: 'sw_kids_7_15', title: 'Kids (7–15 years)' },
            { id: 'sw_kids_under_6', title: 'Kids (Under 6)' },
            { id: 'sw_adults', title: 'Adults' },
            { id: 'sw_ladies', title: 'Ladies Coaching' }
          ]
        );
        break;
      }

      state.data.batchKey = key;
      await sendBatchInfo(from, key);
      await sendButtons(
        from,
        'Would you like to try a free trial class before deciding?',
        ['Book Trial', 'More Info', 'Not Interested']
      );
      state.step = 'awaiting_decision';
      break;
    }

    // ---- BADMINTON AGE ----
    case 'awaiting_badminton_age': {
      if (lower.includes('kid') || lower.includes('child')) {
        state.data.category = 'Kids';
        state.data.batchKey = 'badminton_kids';
      } else if (lower.includes('adult')) {
        state.data.category = 'Adults';
        state.data.batchKey = 'badminton_adults';
      } else {
        await sendButtons(from, 'Please pick one:', ['Kids', 'Adults']);
        break;
      }

      await sendButtons(
        from,
        'What is the current skill level?',
        ['Beginner', 'Intermediate', 'Advanced']
      );
      state.step = 'awaiting_badminton_level';
      break;
    }

    // ---- BADMINTON LEVEL ----
    case 'awaiting_badminton_level': {
      if (lower.includes('begin')) {
        state.data.level = 'Beginner';
      } else if (lower.includes('inter')) {
        state.data.level = 'Intermediate';
      } else if (lower.includes('adv')) {
        state.data.level = 'Advanced';
      } else {
        await sendButtons(from, 'Please pick one:', ['Beginner', 'Intermediate', 'Advanced']);
        break;
      }

      await sendBatchInfo(from, state.data.batchKey);
      await sendButtons(
        from,
        'Would you like to try a free trial class before deciding?',
        ['Book Trial', 'More Info', 'Not Interested']
      );
      state.step = 'awaiting_decision';
      break;
    }

    // ---- DECISION ----
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
          'Sure! A coach from our team will reach out to you shortly with more details. Thanks for your interest! 🙏\n\nType "restart" anytime to start a new enquiry.'
        );
        await logLead(from, state.data);
        clearState(from);
      } else if (lower.includes('not') || lower.includes('no')) {
        state.data.status = 'Not Interested';
        await sendText(
          from,
          'No problem at all! Feel free to reach out anytime in the future. Have a great day! 😊\n\nType "restart" anytime to start a new enquiry.'
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

    // ---- TRIAL DATE ----
    case 'awaiting_trial_date': {
      state.data.trialDate = text;
      await sendText(
        from,
        `Awesome! ✅\n\nYour trial is noted for: *${text}*\n\nOur coach will confirm the exact slot with you shortly. See you soon! 🏸🏊\n\nType "restart" anytime to start a new enquiry.`
      );
      await logLead(from, state.data);
      clearState(from);
      break;
    }
  }

  if (userStates.has(from)) saveState(from, state);
}

// ============================================================
// FORMAT AND SEND BATCH INFO
// ============================================================
async function sendBatchInfo(to, key) {
  const info = BATCH_INFO[key];
  if (!info) return;

  let msg = `*${info.label}*\n`;
  if (info.note) msg += `\n${info.note}\n`;

  const t = info.timings;

  // Swimming style — weekday/weekend
  if (t.weekday && t.weekend) {
    msg += `\n📅 *Weekday batches:*\n`;
    msg += t.weekday.map(s => `  • ${s}`).join('\n');
    msg += `\n\n📅 *Weekend batches:*\n`;
    msg += t.weekend.map(s => `  • ${s}`).join('\n');
  }

  // Badminton style — morning/evening/compensation/weekend
  if (t.weekday_morning) {
    msg += `\n🌅 *Weekday Morning:*\n`;
    msg += t.weekday_morning.map(s => `  • ${s}`).join('\n');
  }
  if (t.weekday_evening) {
    msg += `\n\n🌆 *Weekday Evening:*\n`;
    msg += t.weekday_evening.map(s => `  • ${s}`).join('\n');
  }
  if (t.compensation) {
    msg += `\n\n🔄 *Compensation batches (if you miss a session):*\n`;
    msg += t.compensation.map(s => `  • ${s}`).join('\n');
  }
  if (t.weekend && !t.weekday) {
    msg += `\n\n📅 *Weekend:*\n`;
    msg += t.weekend.map(s => `  • ${s}`).join('\n');
  }

  msg += `\n\n💰 *Pricing:*\n${info.pricing}`;

  await sendText(to, msg);
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
        text: { preview_url: false, body }
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

// WhatsApp List message — supports up to 10 options (used for swimming categories)
async function sendList(to, body, buttonText, items) {
  const rows = items.map(item => ({
    id: item.id,
    title: item.title.slice(0, 24),
    description: item.description || ''
  }));

  try {
    await axios.post(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body },
          action: {
            button: buttonText.slice(0, 20),
            sections: [
              {
                title: 'Options',
                rows
              }
            ]
          }
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
    console.error('sendList failed:', err.response?.data || err.message);
  }
}

// ============================================================
// GOOGLE SHEETS LOGGING
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
      category: data.category || '',
      level: data.level || '',
      status: data.status || '',
      trialDate: data.trialDate || ''
    });
    console.log('Logged lead:', phone, data.status);
  } catch (err) {
    console.error('logLead failed:', err.message);
  }
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (_req, res) => res.send('Bot is running 🚀'));

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
});
