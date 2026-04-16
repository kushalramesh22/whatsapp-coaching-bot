/**
 * Google Apps Script - Paste this into script.google.com
 * attached to your Google Sheet.
 *
 * This creates a free webhook endpoint that your bot will POST
 * new leads to. Each lead becomes a new row in the sheet.
 */

function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const data = JSON.parse(e.postData.contents);

    // If sheet is empty, add headers first
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Timestamp',
        'Phone',
        'Name',
        'Sport',
        'Age Group',
        'Status',
        'Trial Date'
      ]);
    }

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.phone || '',
      data.name || '',
      data.sport || '',
      data.ageGroup || '',
      data.status || '',
      data.trialDate || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Optional: Lets you verify the webhook is live by opening it in a browser
function doGet() {
  return ContentService
    .createTextOutput('Sheets webhook is live ✅')
    .setMimeType(ContentService.MimeType.TEXT);
}
