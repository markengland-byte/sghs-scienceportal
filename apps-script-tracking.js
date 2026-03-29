/**
 * SGHS Portal Tracking — Apps Script
 *
 * SETUP: Paste this ENTIRE file into Extensions > Apps Script
 * It will create all 4 tabs with correct headers automatically.
 *
 * STEP 1: Paste this code
 * STEP 2: Run the "setupSheet" function once (click Run button or menu Run > setupSheet)
 * STEP 3: Deploy as Web App:
 *           Click Deploy > New Deployment
 *           Type: Web app
 *           Execute as: Me
 *           Who has access: Anyone
 *           Copy the URL and give it to Claude
 *
 * CHANGE YOUR PASSWORD on line 30 below!
 */

// ═══════════════════════════════════════════════════
// CONFIG — Change your dashboard password here
// ═══════════════════════════════════════════════════
var DASHBOARD_PASSWORD = 'sghs2026';

// ═══════════════════════════════════════════════════
// ONE-TIME SETUP — Run this once to create all tabs
// ═══════════════════════════════════════════════════
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Tab definitions: name and header row
  var tabs = {
    'Scores': ['Timestamp', 'Student', 'Module', 'Lesson', 'Score', 'Total', 'Pct', 'TimeOnQuiz'],
    'QuizDetail': ['Timestamp', 'Student', 'Module', 'Lesson', 'QNum', 'QuestionText', 'StudentAnswer', 'CorrectAnswer', 'IsCorrect'],
    'Checkpoints': ['Timestamp', 'Student', 'Module', 'Lesson', 'ResponseText', 'CharCount'],
    'Activity': ['Timestamp', 'Student', 'Module', 'Lesson', 'Event', 'Duration']
  };

  var tabNames = Object.keys(tabs);

  for (var i = 0; i < tabNames.length; i++) {
    var name = tabNames[i];
    var headers = tabs[name];
    var sheet = ss.getSheetByName(name);

    // Create tab if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }

    // Clear and write headers
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // Format header row
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#0f2240');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');

    // Auto-resize columns
    for (var c = 1; c <= headers.length; c++) {
      sheet.setColumnWidth(c, name === 'QuizDetail' ? 180 : 150);
    }
    // Make Timestamp column wider
    sheet.setColumnWidth(1, 180);
    // Make text columns wider
    if (name === 'QuizDetail') {
      sheet.setColumnWidth(6, 400); // QuestionText
      sheet.setColumnWidth(7, 200); // StudentAnswer
      sheet.setColumnWidth(8, 200); // CorrectAnswer
    }
    if (name === 'Checkpoints') {
      sheet.setColumnWidth(5, 500); // ResponseText
    }

    // Freeze header row
    sheet.setFrozenRows(1);
  }

  // Remove default "Sheet1" if it exists and is empty
  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() <= 1) {
    try { ss.deleteSheet(sheet1); } catch(e) {}
  }

  SpreadsheetApp.getUi().alert('Setup complete! 4 tabs created:\n\n• Scores\n• QuizDetail\n• Checkpoints\n• Activity\n\nNow deploy as a Web App.');
}

// ═══════════════════════════════════════════════════
// POST HANDLER — Receives data from student browsers
// ═══════════════════════════════════════════════════
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = data.action || 'score';
    var ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

    if (action === 'score') {
      ss.getSheetByName('Scores').appendRow([
        ts,
        data.student,
        data.module,
        data.lesson,
        data.score,
        data.total,
        data.pct,
        data.timeOnQuiz || ''
      ]);
    }

    else if (action === 'quizDetail') {
      var sheet = ss.getSheetByName('QuizDetail');
      var questions = data.questions || [];
      for (var i = 0; i < questions.length; i++) {
        var q = questions[i];
        sheet.appendRow([
          ts,
          data.student,
          data.module,
          data.lesson,
          q.qNum,
          q.questionText,
          q.studentAnswer,
          q.correctAnswer,
          q.isCorrect ? 'YES' : 'NO'
        ]);
      }
    }

    else if (action === 'checkpoint') {
      ss.getSheetByName('Checkpoints').appendRow([
        ts,
        data.student,
        data.module,
        data.lesson,
        data.responseText,
        data.charCount
      ]);
    }

    else if (action === 'activity') {
      ss.getSheetByName('Activity').appendRow([
        ts,
        data.student,
        data.module,
        data.lesson,
        data.event,
        data.duration || ''
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══════════════════════════════════════════════════
// GET HANDLER — Returns data for teacher dashboard
// ═══════════════════════════════════════════════════
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e.parameter && e.parameter.action) || 'summary';
    var password = (e.parameter && e.parameter.pw) || '';

    // Password check
    if (password !== DASHBOARD_PASSWORD) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheetName;
    if (action === 'summary') sheetName = 'Scores';
    else if (action === 'quizDetail') sheetName = 'QuizDetail';
    else if (action === 'checkpoints') sheetName = 'Checkpoints';
    else if (action === 'activity') sheetName = 'Activity';
    else {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Unknown action' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = ss.getSheetByName(sheetName);
    var allData = sheet.getDataRange().getValues();
    if (allData.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var headers = allData.shift();
    var studentFilter = (e.parameter && e.parameter.student) || '';
    var moduleFilter = (e.parameter && e.parameter.module) || '';

    var rows = [];
    for (var i = 0; i < allData.length; i++) {
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = allData[i][j];
      }
      if (studentFilter && obj.Student !== studentFilter) continue;
      if (moduleFilter && obj.Module !== moduleFilter) continue;
      rows.push(obj);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: rows }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}