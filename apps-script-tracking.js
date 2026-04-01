/**
 * SGHS Portal Tracking — Apps Script
 *
 * SETUP: Paste this ENTIRE file into Extensions > Apps Script
 * It will create all tabs with correct headers automatically.
 *
 * STEP 1: Paste this code
 * STEP 2: Run "addAssignmentsTab" to add the new Assignments tab (safe — does NOT touch existing tabs)
 *         OR run "setupSheet" on a fresh spreadsheet to create all 5 tabs
 * STEP 3: Deploy as Web App (or update existing deployment):
 *           Click Deploy > Manage Deployments > Edit (pencil icon)
 *           Version: New version
 *           Click Deploy
 *
 * CHANGE YOUR PASSWORD on line 32 below!
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
    'Scores': ['Timestamp', 'Student', 'ClassPeriod', 'Module', 'Lesson', 'Score', 'Total', 'Pct', 'TimeOnQuiz', 'AssignmentId'],
    'QuizDetail': ['Timestamp', 'Student', 'ClassPeriod', 'Module', 'Lesson', 'QNum', 'QuestionText', 'StudentAnswer', 'CorrectAnswer', 'IsCorrect', 'AssignmentId'],
    'Checkpoints': ['Timestamp', 'Student', 'ClassPeriod', 'Module', 'Lesson', 'ResponseText', 'CharCount'],
    'Activity': ['Timestamp', 'Student', 'ClassPeriod', 'Module', 'Lesson', 'Event', 'Duration'],
    'Assignments': ['AssignmentId', 'CreatedAt', 'Title', 'Periods', 'Mode', 'Seed', 'StdTargets', 'QuestionCount', 'Active', 'AllowRetake']
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

  Logger.log('Setup complete! 5 tabs created: Scores, QuizDetail, Checkpoints, Activity, Assignments. Now deploy as a Web App.');
}

// ═══════════════════════════════════════════════════
// SAFE UPGRADE — Adds Assignments tab without touching existing tabs
// Run this if you already have data in Scores/QuizDetail/etc.
// ═══════════════════════════════════════════════════
function addAssignmentsTab() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Create Assignments tab if it doesn't exist
  var headers = ['AssignmentId', 'CreatedAt', 'Title', 'Periods', 'Mode', 'Seed', 'StdTargets', 'QuestionCount', 'Active', 'AllowRetake'];
  var sheet = ss.getSheetByName('Assignments');
  if (!sheet) {
    sheet = ss.insertSheet('Assignments');
  }
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#0f2240');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');
  for (var c = 1; c <= headers.length; c++) {
    sheet.setColumnWidth(c, 150);
  }
  sheet.setColumnWidth(3, 250); // Title
  sheet.setColumnWidth(7, 300); // StdTargets JSON
  sheet.setFrozenRows(1);

  // 2. Add AssignmentId column to Scores if missing
  var scores = ss.getSheetByName('Scores');
  if (scores) {
    var sHeaders = scores.getRange(1, 1, 1, scores.getLastColumn()).getValues()[0];
    if (sHeaders.indexOf('AssignmentId') === -1) {
      var col = sHeaders.length + 1;
      scores.getRange(1, col).setValue('AssignmentId');
      scores.getRange(1, col).setFontWeight('bold').setBackground('#0f2240').setFontColor('#ffffff').setHorizontalAlignment('center');
      scores.setColumnWidth(col, 180);
    }
  }

  // 3. Add AssignmentId column to QuizDetail if missing
  var qd = ss.getSheetByName('QuizDetail');
  if (qd) {
    var qdHeaders = qd.getRange(1, 1, 1, qd.getLastColumn()).getValues()[0];
    if (qdHeaders.indexOf('AssignmentId') === -1) {
      var col2 = qdHeaders.length + 1;
      qd.getRange(1, col2).setValue('AssignmentId');
      qd.getRange(1, col2).setFontWeight('bold').setBackground('#0f2240').setFontColor('#ffffff').setHorizontalAlignment('center');
      qd.setColumnWidth(col2, 180);
    }
  }

  Logger.log('Upgrade complete! Assignments tab created, AssignmentId column added to Scores and QuizDetail. Now update your Web App deployment.');
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

    var cp = data.classPeriod || '';

    if (action === 'score') {
      ss.getSheetByName('Scores').appendRow([
        ts,
        data.student,
        cp,
        data.module,
        data.lesson,
        data.score,
        data.total,
        data.pct,
        data.timeOnQuiz || '',
        data.assignmentId || ''
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
          cp,
          data.module,
          data.lesson,
          q.qNum,
          q.questionText,
          q.studentAnswer,
          q.correctAnswer,
          q.isCorrect ? 'YES' : 'NO',
          data.assignmentId || ''
        ]);
      }
    }

    // ── Teacher creates a new assignment (password-gated) ──
    else if (action === 'createAssignment') {
      if (data.pw !== DASHBOARD_PASSWORD) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var assignId = 'a-' + Date.now();
      ss.getSheetByName('Assignments').appendRow([
        assignId,
        ts,
        data.title || 'Untitled',
        data.periods || 'ALL',
        data.mode || 'randomized',
        data.seed || 0,
        data.stdTargets || '{}',
        data.questionCount || 50,
        'YES',
        data.allowRetake || 'NO'
      ]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', assignmentId: assignId }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Teacher updates an assignment (password-gated) ──
    else if (action === 'updateAssignment') {
      if (data.pw !== DASHBOARD_PASSWORD) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var aSheet = ss.getSheetByName('Assignments');
      var aData = aSheet.getDataRange().getValues();
      var aHeaders = aData[0];
      var found = false;
      for (var r = 1; r < aData.length; r++) {
        if (aData[r][0] === data.assignmentId) {
          // Update fields that are provided
          if (data.active !== undefined) {
            var activeCol = aHeaders.indexOf('Active') + 1;
            aSheet.getRange(r + 1, activeCol).setValue(data.active);
          }
          if (data.title !== undefined) {
            var titleCol = aHeaders.indexOf('Title') + 1;
            aSheet.getRange(r + 1, titleCol).setValue(data.title);
          }
          if (data.periods !== undefined) {
            var perCol = aHeaders.indexOf('Periods') + 1;
            aSheet.getRange(r + 1, perCol).setValue(data.periods);
          }
          if (data.allowRetake !== undefined) {
            var retakeCol = aHeaders.indexOf('AllowRetake') + 1;
            aSheet.getRange(r + 1, retakeCol).setValue(data.allowRetake);
          }
          found = true;
          break;
        }
      }
      return ContentService.createTextOutput(JSON.stringify({ status: found ? 'ok' : 'not_found' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    else if (action === 'checkpoint') {
      ss.getSheetByName('Checkpoints').appendRow([
        ts,
        data.student,
        cp,
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
        cp,
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

    // ── Student-facing: get active assignments for a period (no password needed) ──
    if (action === 'assignments' && !password) {
      var period = (e.parameter && e.parameter.period) || '';
      var aSheet = ss.getSheetByName('Assignments');
      if (!aSheet || aSheet.getLastRow() <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var aData = aSheet.getDataRange().getValues();
      var aHeaders = aData.shift();
      var assignments = [];
      for (var a = 0; a < aData.length; a++) {
        var row = {};
        for (var h = 0; h < aHeaders.length; h++) {
          row[aHeaders[h]] = aData[a][h];
        }
        // Only return active assignments
        if (String(row.Active).toUpperCase() !== 'YES') continue;
        // Check period match
        var periods = String(row.Periods).toUpperCase();
        if (periods !== 'ALL' && period) {
          var periodList = periods.split(',').map(function(p) { return p.trim(); });
          if (periodList.indexOf(String(period)) === -1) continue;
        }
        // Return only student-safe fields
        assignments.push({
          assignmentId: row.AssignmentId,
          title: row.Title,
          mode: row.Mode,
          seed: Number(row.Seed) || 0,
          stdTargets: row.StdTargets,
          questionCount: Number(row.QuestionCount) || 50,
          allowRetake: String(row.AllowRetake).toUpperCase() === 'YES'
        });
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: assignments }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── All other actions require password ──
    if (password !== DASHBOARD_PASSWORD) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ── Teacher-facing: get all assignments (with password) ──
    if (action === 'assignments') {
      var tSheet = ss.getSheetByName('Assignments');
      if (!tSheet || tSheet.getLastRow() <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var tData = tSheet.getDataRange().getValues();
      var tHeaders = tData.shift();
      var tRows = [];
      for (var t = 0; t < tData.length; t++) {
        var tObj = {};
        for (var tj = 0; tj < tHeaders.length; tj++) {
          tObj[tHeaders[tj]] = tData[t][tj];
        }
        tRows.push(tObj);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: tRows }))
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

