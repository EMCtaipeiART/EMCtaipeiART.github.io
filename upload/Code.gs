/**
 * Google Drive 圖片上傳器
 * 適合部署成 Apps Script Web App，再嵌入 Google Sites。
 */

// 可選擇的上傳資料夾。前台只傳入 key，實際資料夾 ID 由後端決定，
// 避免使用者自行竄改成未核准的 Google Drive 資料夾。
const UPLOAD_TARGETS = {
  Machi: {
    name: 'Machi',
    folderId: '1Atv0iIepcQ6JaCS0F_yFsUQurj1ibla5'
  },
  Anna: {
    name: 'Anna',
    folderId: '1Ea7QIkkEvyRN_5mhTM3LPipQ_X6GKIpA'
  },
  Karl: {
    name: 'Karl',
    folderId: '11cgZTXz6nYX21QTFmUcheisEaGYo2Mtb'
  },
  Noise: {
    name: 'Noise',
    folderId: '1FZ4KUlHM7XGvWKGsVidyoudTmiP9ltDn'
  },
  Amber: {
    name: 'Amber',
    folderId: '14JtIBWEjX8Q1dRdE18bjDE93CM-VKg45'
  },
  Leona: {
    name: 'Leona',
    folderId: '1sSWQrwCe5naQYTUUl5F65WehMk-NDpm0'
  }
};

// 一般使用者頭像的母資料夾。各使用者會以設定表中的正式名字
// 建立同名子資料夾，不直接信任前端傳入的資料夾名稱。
const USER_UPLOAD_ROOT_FOLDER_ID =
  '1KHtmAVbSh7kht0ge3b9lDZpmCClwkiJk';
const MAIN_APP_API_URL =
  'https://machi-design-api.machi-chen.workers.dev/api';

// 設計師設定工作表。
const DESIGNER_SPREADSHEET_ID =
  '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const DESIGNER_SHEET_ID = 988186149;
const REELS_SHEET_ID = 1503122183;
const REELS_HEADERS = [
  '名字',
  '限時動態連結',
  '保留期限',
  '到期時間',
  '按讚',
  '倒讚',
  '留言'
];
const UPLOAD_APP_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/script.scriptapp'
];
const STORY_EXPIRATIONS_PROPERTY = 'DESIGNER_STORY_EXPIRATIONS_V1';
const STORY_EXPIRATION_HANDLER = 'expireDesignerStories_';

// 單張圖片大小限制，單位 MB
const MAX_FILE_SIZE_MB = 10;

// 案件設計圖（自動同步用）的 Drive 母資料夾。
const CASE_DESIGN_IMAGE_ROOT_FOLDER_ID = '1rBJQ3uvDeFruf7Th2yF2xQWr0c0F2-nH';

// 一次最多接受的圖片數量，避免單次請求過大或誤傳整個資料夾。
const MAX_CASE_DESIGN_IMAGES_PER_REQUEST = 20;

// 資料庫後台「備份至雲端試算表」寫入的分頁名稱（gid=1244538986，跟填單
// 案件寫入的是同一個「database」分頁），以及一次最多接受的案件筆數。
const DATABASE_BACKUP_SHEET_NAME = 'database';
const MAX_DATABASE_BACKUP_ROWS = 20000;

// 最近圖片顯示數量
const RECENT_FILE_LIMIT = 12;
const USER_IDENTITY_CACHE_SECONDS = 300;
const USER_FOLDER_CACHE_SECONDS = 21600;

/**
 * 顯示前台頁面。
 */
function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('upload')
    .setTitle('圖片上傳')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 給非瀏覽器呼叫端用的 API 入口（例如主系統 Worker 觸發的案件設計圖同步），
 * 因為 `google.script.run` 只能在這個 Web App 自己的 upload.html
 * 裡面用，外部程式沒辦法用那套機制呼叫 uploadImage() 這類函式，
 * 需要一個一般的 HTTP POST 入口。
 *
 * 部署設定要注意：這個部署（Deploy → Manage deployments）的
 * 「具有存取權的使用者」必須是「任何人」，不能是「必須是 Google 帳戶」，
 * 否則外部腳本呼叫會被導去 Google 登入頁，收到的不是 JSON 而是 HTML。
 * 這件事沒辦法在這裡自動驗證，部署後要實際用 curl 或監控程式測一次。
 *
 * 每個動作各自用 `NAS_WATCHER_API_KEY` 這組指令碼屬性驗證身分，
 * 不吃一般使用者的登入 token，所以本身不會因為 Web App 開放給「任何人」
 * 就變成任何人都能寫入——沒有正確金鑰一律被擋。
 */
function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return jsonOutput_({ success: false, message: '請求內容不是合法的 JSON' });
  }

  const action = String(payload.action || '').trim();
  let result;
  if (action === 'uploadCaseDesignImages') {
    result = uploadCaseDesignImages(payload);
  } else if (action === 'backupDatabaseTableToSheet') {
    result = backupDatabaseTableToSheet(payload);
  } else {
    result = { success: false, message: '不支援的動作：' + (action || '（空白）') };
  }
  return jsonOutput_(result);
}

function jsonOutput_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 首次加入試算表寫入功能後，請在 Apps Script 編輯器手動執行一次。
 * 執行時會顯示 Google 授權視窗；完成後再重新部署 Web App。
 */
function authorizeUploadAppOnce() {
  ScriptApp.requireScopes(
    ScriptApp.AuthMode.FULL,
    UPLOAD_APP_SCOPES
  );

  const spreadsheet = SpreadsheetApp.openById(DESIGNER_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getSheetId() === DESIGNER_SHEET_ID;
  });
  const reelsSheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getSheetId() === REELS_SHEET_ID;
  });
  const folder = DriveApp.getFolderById(
    UPLOAD_TARGETS.Machi.folderId
  );

  if (!sheet) {
    throw new Error('已取得試算表權限，但找不到設計師設定工作表');
  }
  if (!reelsSheet) {
    throw new Error('已取得試算表權限，但找不到 reels 工作表');
  }

  const mainAppResponse = UrlFetchApp.fetch(
    MAIN_APP_API_URL + '?action=ping&ts=' + Date.now(),
    {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    }
  );
  const mainAppStatus = mainAppResponse.getResponseCode();
  let mainAppResult = {};
  try {
    mainAppResult = JSON.parse(mainAppResponse.getContentText());
  } catch (error) {}
  if (mainAppStatus < 200 || mainAppStatus >= 300 || !mainAppResult.ok) {
    throw new Error(
      '已取得 Google Drive 與試算表權限，但主系統連線測試失敗'
    );
  }

  return {
    success: true,
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    reelsSheetName: reelsSheet.getName(),
    driveFolderName: folder.getName(),
    mainAppVersion: mainAppResult.version || '',
    message: 'Google Drive、試算表與主系統連線權限已完成授權'
  };
}

/**
 * 提供前台可選擇的核准資料夾清單。
 */
function getUploadTargets(designer) {
  try {
    const isUserContext = designer &&
      typeof designer === 'object' &&
      String(designer.mode || '').trim().toLowerCase() === 'user';
    const target = isUserContext
      ? getUserUploadTarget_(
          designer.user,
          designer.account,
          designer.editorToken,
          false
        )
      : getUploadTargetFromContext_(designer);

    return {
      success: true,
      mode: target.mode,
      designer: target.mode === 'designer' ? target.key : '',
      user: target.mode === 'user' ? target.name : '',
      account: target.account || '',
      defaultKey: target.key,
      targets: [{
        key: target.key,
        name: target.name,
        folderId: target.folderId || '',
        folderUrl: target.folderId ? createFolderUrl_(target.folderId) : ''
      }]
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      message: error.message || '無法取得設計師資料夾設定'
    };
  }
}

/**
 * 上傳圖片到 Google Drive。
 *
 * @param {Object} payload 前台傳入的圖片資料
 * @return {Object} 上傳結果
 */
function uploadImage(payload) {
  try {
    validatePayload_(payload);

    const target = getUploadTargetFromContext_(payload);
    const folder = DriveApp.getFolderById(target.folderId);

    const mimeType = payload.mimeType;
    const extension = getExtension_(payload.fileName, mimeType);
    const finalFileName = createFileName_(payload.fileName, extension);

    const base64Content = removeDataUrlPrefix_(payload.base64);
    const bytes = Utilities.base64Decode(base64Content);

    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;

    if (bytes.length > maxBytes) {
      throw new Error(`圖片不可超過 ${MAX_FILE_SIZE_MB} MB`);
    }

    const blob = Utilities.newBlob(
      bytes,
      mimeType,
      finalFileName
    );

    const file = folder.createFile(blob);

    /*
     * 將圖片設定為知道連結的人可查看。
     * 如果 Workspace 管理員禁止對外分享，這一步可能會被阻擋。
     */
    let isPublic = true;
    let sharingWarning = '';

    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );
    } catch (sharingError) {
      // 檔案已由 createFile() 建立成功。部分 Workspace 網域會禁止
      // ANYONE_WITH_LINK；這不應該讓前台誤判整次上傳失敗。
      isPublic = false;
      sharingWarning =
        '圖片已上傳，但網域政策不允許設為「知道連結的人皆可查看」。' +
        '請使用有資料夾權限的 Google 帳號開啟。';
      console.warn(sharingWarning, sharingError);
    }

    const fileId = file.getId();
    let userAvatarUrl = '';

    if (target.mode === 'user') {
      const context = getUserSheetContext_(target.name, target.account);
      const avatarColumn = ensureHeaderColumn_(
        context.sheet,
        context.headers,
        '頭像連結'
      );
      userAvatarUrl = createUploadedImageUrl_(fileId);
      context.sheet
        .getRange(context.rowNumber, avatarColumn)
        .setValue(userAvatarUrl);
      SpreadsheetApp.flush();

      // 前台實際讀取的是 Worker 的 JSON 資料庫，不是這份試算表；
      // 沒有這一步，頭像只會寫進舊試算表，前台會在下一次讀取設定時
      // 被打回原本的頭像，使用者會覺得「上傳完頭像沒有換」。
      callMainAppJsonAction_('saveUserSettings', {
        editorToken: payload.editorToken,
        account: target.account,
        settings: { avatar: userAvatarUrl }
      });
    }

    return {
      success: true,
      file: {
        id: fileId,
        name: file.getName(),
        mimeType: mimeType,
        size: bytes.length,
        sizeText: formatFileSize_(bytes.length),
        isPublic: isPublic,
        sharingWarning: sharingWarning,
        targetKey: target.key,
        targetName: target.name,
        mode: target.mode,
        designer: target.mode === 'designer' ? target.key : '',
        user: target.mode === 'user' ? target.name : '',
        account: target.account || '',
        avatarUpdated: target.mode === 'user',
        imageUrl: userAvatarUrl,
        folderId: target.folderId,
        folderName: folder.getName(),
        folderUrl: createFolderUrl_(target.folderId),
        uploadedAt: Utilities.formatDate(
          new Date(),
          Session.getScriptTimeZone(),
          'yyyy/MM/dd HH:mm:ss'
        ),

        // Google Drive 預覽頁
        driveViewUrl:
          `https://drive.google.com/file/d/${fileId}/view`,

        // 適合 img 標籤使用的圖片網址
        publicImageUrl:
          `https://drive.google.com/uc?export=view&id=${fileId}`,

        // 備用縮圖網址
        thumbnailUrl:
          `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,

        // 下載網址
        downloadUrl:
          `https://drive.google.com/uc?export=download&id=${fileId}`
      }
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      message: error.message || '圖片上傳失敗'
    };
  }
}

/**
 * 案件設計圖上傳（服務端對服務端呼叫的入口，走 doPost，不是 google.script.run）。
 *
 * 跟 uploadImage() 的差異：uploadImage() 是給登入中的使用者在瀏覽器裡用，
 * 靠 editorToken 驗證身分；這支是給沒有登入畫面的服務對服務呼叫用，靠
 * NAS_WATCHER_API_KEY 這組獨立金鑰驗證，兩者互相獨立、不共用同一種
 * 驗證方式，其中一邊金鑰外流不會連帶讓另一邊也被冒用。
 *
 * @param {Object} payload
 *   serviceKey  必填，需與指令碼屬性 NAS_WATCHER_API_KEY 相符
 *   caseId      必填，案件編號
 *   round       必填，修改輪次，0 代表初稿
 *   designer    必填，設計負責人（用於目的地資料夾路徑）
 *   client      必填，客戶別（用於目的地資料夾路徑）
 *   year        必填，年度（用於目的地資料夾路徑）
 *   month       必填，月份（用於目的地資料夾路徑）
 *   source      選填，預設 'nas-watcher'
 *   images      必填，[{fileName, mimeType, base64, dedupeKey}, ...]；NAS 呼叫端
 *               的 dedupeKey 是同案件／輪次／來源檔案版本的穩定 SHA-256，
 *               網路逾時重送時用來沿用既有 Drive 檔案
 */
function uploadCaseDesignImages(payload) {
  try {
    payload = payload || {};
    verifyNasWatcherServiceKey_(payload.serviceKey);

    const caseId = String(payload.caseId || '').trim();
    const round = Number(payload.round);
    const images = Array.isArray(payload.images) ? payload.images : [];

    if (!caseId) throw new Error('缺少案件編號');
    if (!Number.isFinite(round) || round < 0) throw new Error('缺少修改輪次（0=初稿）');
    if (!images.length) throw new Error('沒有收到任何圖片');
    if (images.length > MAX_CASE_DESIGN_IMAGES_PER_REQUEST) {
      throw new Error(`一次最多上傳 ${MAX_CASE_DESIGN_IMAGES_PER_REQUEST} 張`);
    }
    if (!CASE_DESIGN_IMAGE_ROOT_FOLDER_ID) {
      throw new Error('尚未設定 CASE_DESIGN_IMAGE_ROOT_FOLDER_ID，請先在 Drive 建立母資料夾並填入 ID');
    }

    const rootFolder = DriveApp.getFolderById(CASE_DESIGN_IMAGE_ROOT_FOLDER_ID);
    const folder = getOrCreateNestedFolder_(rootFolder, [
      payload.designer || '未指定設計師',
      payload.client || '未分類客戶',
      payload.year || String(new Date().getFullYear()),
      payload.month || String(new Date().getMonth() + 1).padStart(2, '0'),
      caseId
    ]);
    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    const uploadedImages = uploadImagesToFolder_(images, folder, maxBytes);
    const uploadedUrls = uploadedImages.map(function (item) { return item.url; });

    const databaseSync = callMainAppJsonAction_('addCaseDesignImages', {
      serviceKey: payload.serviceKey,
      caseId: caseId,
      round: round,
      images: uploadedImages,
      source: payload.source || 'nas-watcher'
    });

    return {
      success: true,
      caseId: caseId,
      round: round,
      count: uploadedUrls.length,
      imageUrls: uploadedUrls,
      folderUrl: createFolderUrl_(folder.getId()),
      jsonRevision: databaseSync.jsonRevision || 0,
      githubCommitSha: databaseSync.githubCommitSha || ''
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: error.message || '案件設計圖上傳失敗' };
  }
}

function verifyNasWatcherServiceKey_(serviceKey) {
  const expected = PropertiesService.getScriptProperties().getProperty('NAS_WATCHER_API_KEY');
  const provided = String(serviceKey || '').trim();
  if (!expected) {
    throw new Error('Apps Script 尚未設定 NAS_WATCHER_API_KEY 指令碼屬性，請先設定後再部署');
  }
  if (!provided || provided !== expected) {
    throw new Error('服務金鑰不正確，拒絕上傳');
  }
}

/**
 * 資料庫後台「備份至雲端試算表」按鈕的服務端對服務端呼叫入口，走 doPost，
 * 由 Cloudflare Worker 的 backupDatabaseToSheet action 呼叫。
 *
 * 跟 uploadCaseDesignImages() 一樣不吃使用者登入 token，改用獨立的
 * DATABASE_BACKUP_API_KEY 指令碼屬性驗證身分，跟 NAS_WATCHER_API_KEY
 * 刻意分開，其中一組外流不會連帶讓另一組也被冒用。
 *
 * 這支函式**只覆寫「JSON 欄位名稱」跟「試算表表頭列」剛好同名的欄位**：
 * 讀出試算表「database」分頁（gid=1244538986）目前第一列的表頭，只有出現
 * 在兩邊的欄位才會被寫入新值；試算表上有、JSON 沒有的欄位（例如舊資料還
 * 留著的「時間標記」欄）完全不會被清空或搬動，JSON 有、試算表還沒手動加
 * 上的新欄位（例如新增的「修改次數」欄）也不會被硬塞進試算表。案件用主鍵
 * （預設「案件編號」）比對既有列：對得到就地更新相符的欄位，對不到就在
 * 最後新增一列（新列只會填相符的欄位，其餘欄位留空，因為那些欄位本來就
 * 不是這次備份的資料來源）。既有的案件列如果在 JSON 裡已經被刪除，這支
 * 函式不會主動刪除試算表上對應的那一列，避免試算表被誤判成「垃圾列」而
 * 遺失使用者可能還需要的歷史紀錄。
 *
 * @param {Object} payload
 *   serviceKey  必填，需與指令碼屬性 DATABASE_BACKUP_API_KEY 相符
 *   headers     必填，JSON 端目前的欄位名稱清單
 *   primaryKey  選填，比對案件列用的主鍵欄位名稱，預設「案件編號」
 *   rows        必填，物件陣列，每個物件的 key 需對應 headers 裡的欄位名稱
 */
function backupDatabaseTableToSheet(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    payload = payload || {};
    verifyDatabaseBackupServiceKey_(payload.serviceKey);

    const headers = Array.isArray(payload.headers) ? payload.headers.map(String) : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const primaryKey = String(payload.primaryKey || '案件編號').trim();
    if (!headers.length) throw new Error('缺少欄位清單');
    if (headers.indexOf(primaryKey) < 0) throw new Error('欄位清單缺少主鍵欄位：' + primaryKey);
    if (rows.length > MAX_DATABASE_BACKUP_ROWS) {
      throw new Error(`資料筆數超過上限（最多 ${MAX_DATABASE_BACKUP_ROWS} 筆）`);
    }

    const spreadsheet = SpreadsheetApp.openById(DESIGNER_SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(DATABASE_BACKUP_SHEET_NAME);
    if (!sheet) throw new Error('找不到「' + DATABASE_BACKUP_SHEET_NAME + '」試算表分頁');

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 1 || lastColumn < 1) {
      throw new Error('試算表分頁目前是空的，請先手動建立跟 JSON 對應的表頭列再備份');
    }

    const grid = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    const sheetHeaders = grid[0].map(String);
    const matchedHeaders = headers.filter(function (header) {
      return sheetHeaders.indexOf(header) >= 0;
    });
    const primaryKeyColumnIndex = sheetHeaders.indexOf(primaryKey);
    if (!matchedHeaders.length || primaryKeyColumnIndex < 0) {
      throw new Error('試算表欄位跟目前 JSON 的欄位沒有任何相符，或試算表缺少主鍵欄位「' + primaryKey + '」');
    }

    const rowIndexByKey = {};
    for (let r = 1; r < grid.length; r++) {
      const key = String(grid[r][primaryKeyColumnIndex] || '').trim();
      if (key) rowIndexByKey[key] = r;
    }

    let updated = 0;
    let appended = 0;
    rows.forEach(function (row) {
      row = row || {};
      const key = String(row[primaryKey] || '').trim();
      if (!key) return;
      let rowIndex = rowIndexByKey[key];
      if (rowIndex === undefined) {
        rowIndex = grid.length;
        grid.push(new Array(lastColumn).fill(''));
        rowIndexByKey[key] = rowIndex;
        appended += 1;
      } else {
        updated += 1;
      }
      matchedHeaders.forEach(function (header) {
        const column = sheetHeaders.indexOf(header);
        const value = row[header];
        grid[rowIndex][column] = value == null ? '' : value;
      });
    });

    const totalRows = grid.length;
    if (sheet.getMaxRows() < totalRows) {
      sheet.insertRowsAfter(sheet.getMaxRows(), totalRows - sheet.getMaxRows());
    }
    sheet.getRange(1, 1, totalRows, lastColumn).setValues(grid);
    SpreadsheetApp.flush();

    return {
      success: true,
      matchedColumns: matchedHeaders.length,
      updated: updated,
      appended: appended,
      sheetName: DATABASE_BACKUP_SHEET_NAME,
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: error.message || '備份至雲端試算表失敗' };
  } finally {
    lock.releaseLock();
  }
}

function verifyDatabaseBackupServiceKey_(serviceKey) {
  const expected = PropertiesService.getScriptProperties().getProperty('DATABASE_BACKUP_API_KEY');
  const provided = String(serviceKey || '').trim();
  if (!expected) {
    throw new Error('Apps Script 尚未設定 DATABASE_BACKUP_API_KEY 指令碼屬性，請先設定後再部署');
  }
  if (!provided || provided !== expected) {
    throw new Error('服務金鑰不正確，拒絕備份');
  }
}

/**
 * 把一批 base64 圖片存進指定資料夾，設定分享權限並回傳可公開讀取的網址。
 * uploadCaseDesignImages()（NAS 監控程式）與 uploadCaseDesignImagesInteractive()
 * （瀏覽器選檔案上傳）共用這段邏輯，差異只在呼叫端的身分驗證方式。
 */
function uploadImagesToFolder_(images, folder, maxBytes) {
  images = Array.isArray(images) ? images : [];
  const hasDedupeKeys = images.some(function (image) {
    return normalizeCaseDesignDedupeKey_(image && image.dedupeKey);
  });
  // Apps Script 可能同時收到「第一次仍在完成、呼叫端因逾時已重送」的兩個
  // request。具防重鍵的案件圖在查找／建立 Drive 檔案期間共用 ScriptLock，
  // 避免兩個 request 都在查找尚未建立時各自 createFile()。
  const lock = hasDedupeKeys ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(30000);

  try {
    return images.map(function (image) {
      image = image || {};
      const mimeType = String(image.mimeType || '').trim();
      if (!mimeType.startsWith('image/')) {
        throw new Error('只允許上傳圖片檔案：' + (image.fileName || '（未命名）'));
      }

      const originalFileName = String(image.fileName || '').trim();
      const extension = getExtension_(image.fileName, mimeType);
      const dedupeKey = normalizeCaseDesignDedupeKey_(image.dedupeKey);
      const finalFileName = dedupeKey
        ? createCaseDesignDedupeFileName_(image.fileName || 'case-image', extension, dedupeKey)
        : createFileName_(image.fileName || 'case-image', extension);
      const base64Content = removeDataUrlPrefix_(image.base64 || '');
      const bytes = Utilities.base64Decode(base64Content);

      if (bytes.length > maxBytes) {
        throw new Error(`圖片超過 ${MAX_FILE_SIZE_MB}MB：` + (image.fileName || '（未命名）'));
      }

      let file = null;
      if (dedupeKey) {
        const existingFiles = folder.getFilesByName(finalFileName);
        if (existingFiles.hasNext()) file = existingFiles.next();
      }
      if (!file) {
        const blob = Utilities.newBlob(bytes, mimeType, finalFileName);
        file = folder.createFile(blob);
      }

      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (sharingError) {
        // 檔案已建立成功，只是網域政策可能不允許「知道連結的人皆可查看」，
        // 不應該讓整次上傳失敗，記個警告即可。
        console.warn('案件設計圖分享設定失敗', sharingError);
      }

      // fileName 保留呼叫端傳入的原始檔名（不是 Drive 內部檔名），讓主系統
      // 能依原始檔名對照「這輪要抓哪些指定圖片」。重送時 dedupeKey 會找到
      // 同一個 Drive 檔案、回傳同一 URL，主資料庫既有的 URL 去重即可生效。
      return { fileName: originalFileName, url: createUploadedImageUrl_(file.getId()) };
    });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function normalizeCaseDesignDedupeKey_(value) {
  const key = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(key) ? key : '';
}

function createCaseDesignDedupeFileName_(originalName, extension, dedupeKey) {
  const originalBase = String(originalName || '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40) || 'image';
  return `nas-${dedupeKey}-${originalBase}.${extension}`;
}

/**
 * 案件設計圖上傳（互動式，設計師/管理者直接在瀏覽器裡選電腦檔案多選上傳，
 * 走 upload.html 的 mode=case-design 區塊、透過 google.script.run 呼叫）。
 *
 * 跟 uploadCaseDesignImages() 的差異：那支是給沒有登入畫面的服務對服務
 * 呼叫（NAS 監控程式）用，靠 NAS_WATCHER_API_KEY 驗證；這支是給登入中的
 * 使用者用，靠 editorToken 驗證 media.manage 權限（跟案件詳情面板「上傳
 * 設計圖」按鈕、修改紀錄彈窗的新增/刪除圖片，都是同一個權限）。
 *
 * @param {Object} payload
 *   editorToken 必填，需具備 media.manage 權限
 *   caseId      必填，案件編號
 *   round       必填，修改輪次，0 代表初稿
 *   designer    必填，設計負責人（用於目的地資料夾路徑）
 *   client      必填，客戶別（用於目的地資料夾路徑）
 *   year        必填，年度（用於目的地資料夾路徑）
 *   month       必填，月份（用於目的地資料夾路徑）
 *   images      必填，[{fileName, mimeType, base64}, ...]
 */
function uploadCaseDesignImagesInteractive(payload) {
  try {
    payload = payload || {};
    verifyMediaManager_(payload.editorToken);

    const caseId = String(payload.caseId || '').trim();
    const round = Number(payload.round);
    const images = Array.isArray(payload.images) ? payload.images : [];

    if (!caseId) throw new Error('缺少案件編號');
    if (!Number.isFinite(round) || round < 0) throw new Error('缺少修改輪次（0=初稿）');
    if (!images.length) throw new Error('沒有收到任何圖片');
    if (images.length > MAX_CASE_DESIGN_IMAGES_PER_REQUEST) {
      throw new Error(`一次最多上傳 ${MAX_CASE_DESIGN_IMAGES_PER_REQUEST} 張`);
    }
    if (!CASE_DESIGN_IMAGE_ROOT_FOLDER_ID) {
      throw new Error('尚未設定 CASE_DESIGN_IMAGE_ROOT_FOLDER_ID，請先在 Drive 建立母資料夾並填入 ID');
    }

    const rootFolder = DriveApp.getFolderById(CASE_DESIGN_IMAGE_ROOT_FOLDER_ID);
    const folder = getOrCreateNestedFolder_(rootFolder, [
      payload.designer || '未指定設計師',
      payload.client || '未分類客戶',
      payload.year || String(new Date().getFullYear()),
      payload.month || String(new Date().getMonth() + 1).padStart(2, '0'),
      caseId
    ]);
    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    const uploadedImages = uploadImagesToFolder_(images, folder, maxBytes);

    const databaseSync = callMainAppJsonAction_('addCaseDesignImages', {
      editorToken: payload.editorToken,
      caseId: caseId,
      round: round,
      images: uploadedImages,
      source: 'manual-upload'
    });

    return {
      success: true,
      caseId: caseId,
      round: round,
      count: uploadedImages.length,
      images: uploadedImages,
      folderUrl: createFolderUrl_(folder.getId()),
      jsonRevision: databaseSync.jsonRevision || 0,
      githubCommitSha: databaseSync.githubCommitSha || ''
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: error.message || '案件設計圖上傳失敗' };
  }
}

/**
 * 依序取得/建立巢狀資料夾（例如 設計師/客戶別/年度/月份/案件編號）。
 */
function getOrCreateNestedFolder_(rootFolder, names) {
  let folder = rootFolder;
  names.forEach(function (name) {
    const safeName = sanitizeUserFolderName_(name) || '未分類';
    const existing = folder.getFoldersByName(safeName);
    folder = existing.hasNext() ? existing.next() : folder.createFolder(safeName);
  });
  return folder;
}

/**
 * 讀取指定資料夾最近上傳的圖片。
 */
function getRecentImages(designer) {
  try {
    const target = getUploadTargetFromContext_(designer);
    const folder = DriveApp.getFolderById(target.folderId);
    const files = folder.getFiles();
    const result = [];

    while (files.hasNext()) {
      const file = files.next();
      const mimeType = file.getMimeType();

      if (!mimeType || !mimeType.startsWith('image/')) {
        continue;
      }

      const fileId = file.getId();

      result.push({
        id: fileId,
        name: file.getName(),
        mimeType: mimeType,
        dateCreated: file.getDateCreated().getTime(),
        dateCreatedText: Utilities.formatDate(
          file.getDateCreated(),
          Session.getScriptTimeZone(),
          'yyyy/MM/dd HH:mm'
        ),
        driveViewUrl:
          `https://drive.google.com/file/d/${fileId}/view`,
        publicImageUrl:
          `https://drive.google.com/uc?export=view&id=${fileId}`,
        thumbnailUrl:
          `https://drive.google.com/thumbnail?id=${fileId}&sz=w800`
      });
    }

    result.sort((a, b) => b.dateCreated - a.dateCreated);

    return {
      success: true,
      targetKey: target.key,
      targetName: target.name,
      folderUrl: createFolderUrl_(target.folderId),
      files: result.slice(0, RECENT_FILE_LIMIT)
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      message: error.message || '無法讀取最近圖片'
    };
  }
}

/**
 * 將一般使用者資料夾內的圖片設為該帳號頭像。
 */
function replaceUserAvatar(payload) {
  try {
    payload = payload || {};
    const target = getUserUploadTarget_(
      payload.user,
      payload.account,
      payload.editorToken
    );
    const fileId = String(payload.fileId || '').trim();
    const file = getAuthorizedUploadedFile_(fileId, target.folderId);
    const imageUrl = createUploadedImageUrl_(file.getId());
    const context = getUserSheetContext_(target.name, target.account);
    const avatarColumn = ensureHeaderColumn_(
      context.sheet,
      context.headers,
      '頭像連結'
    );

    context.sheet
      .getRange(context.rowNumber, avatarColumn)
      .setValue(imageUrl);
    SpreadsheetApp.flush();

    callMainAppJsonAction_('saveUserSettings', {
      editorToken: payload.editorToken,
      account: target.account,
      settings: { avatar: imageUrl }
    });

    return {
      success: true,
      mode: 'user',
      user: target.name,
      account: target.account,
      kind: 'avatar',
      imageUrl: imageUrl,
      fileId: file.getId()
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.message || '使用者頭像設定失敗'
    };
  }
}

/**
 * 刪除一般使用者資料夾中的圖片，並清除頭像欄位的同檔連結。
 */
function deleteUserImages(payload) {
  try {
    payload = payload || {};
    const target = getUserUploadTarget_(
      payload.user,
      payload.account,
      payload.editorToken
    );
    const fileIds = Array.from(new Set(
      (Array.isArray(payload.fileIds) ? payload.fileIds : [])
        .map(function (fileId) {
          return String(fileId || '').trim();
        })
        .filter(Boolean)
    ));

    if (!fileIds.length) throw new Error('請先選取至少一張圖片');
    if (fileIds.length > RECENT_FILE_LIMIT) {
      throw new Error(`一次最多可刪除 ${RECENT_FILE_LIMIT} 張圖片`);
    }

    const files = fileIds.map(function (fileId) {
      return getAuthorizedUploadedFile_(fileId, target.folderId);
    });
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const context = getUserSheetContext_(target.name, target.account);
      const avatarColumn = findHeaderColumn_(context.headers, ['頭像連結']);
      if (avatarColumn) {
        const avatarCell = context.sheet.getRange(
          context.rowNumber,
          avatarColumn
        );
        const avatarValue = String(avatarCell.getDisplayValue() || '');
        if (fileIds.some(function (fileId) {
          return avatarValue.includes(fileId);
        })) {
          avatarCell.clearContent();
        }
      }

      files.forEach(function (file) {
        file.setTrashed(true);
      });
      SpreadsheetApp.flush();

      return {
        success: true,
        mode: 'user',
        user: target.name,
        account: target.account,
        count: fileIds.length,
        fileIds: fileIds,
        message: fileIds.length > 1
          ? `${fileIds.length} 張圖片已刪除`
          : '圖片已刪除'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.message || '圖片刪除失敗'
    };
  }
}

/**
 * 將圖片設定為頭像、大海報或限時動態。
 */
function replaceDesignerImage(payload) {
  try {
    payload = payload || {};
    verifyMediaManager_(payload.editorToken);
    const kind = String(payload.kind || '').trim();

    if (kind === 'story') {
      return setDesignerStories({
        designer: payload.designer,
        fileIds: [payload.fileId],
        durationMinutes: payload.durationMinutes,
        editorToken: payload.editorToken
      });
    }

    const target = getUploadTarget_(payload.designer);
    const headerMap = {
      avatar: '頭像連結',
      poster: '頭像大圖連結'
    };
    const targetHeader = headerMap[kind];

    if (!targetHeader) throw new Error('替換類型錯誤');

    const fileId = String(payload.fileId || '').trim();
    const file = getAuthorizedUploadedFile_(fileId, target.folderId);
    const imageUrl =
      `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w1000`;
    const context = getDesignerSheetContext_(target);
    const targetColumn = ensureHeaderColumn_(
      context.sheet,
      context.headers,
      targetHeader
    );

    context.sheet
      .getRange(context.rowNumber, targetColumn)
      .setValue(imageUrl);
    SpreadsheetApp.flush();

    const profile = { name: target.key };
    profile[kind] = imageUrl;
    const databaseSync = callMainAppJsonAction_('saveDesignerProfiles', {
      editorToken: payload.editorToken,
      profiles: [profile],
      jsonOnly: true
    });

    return {
      success: true,
      designer: target.key,
      kind: kind,
      header: targetHeader,
      imageUrl: imageUrl,
      fileId: file.getId(),
      expiresAt: 0,
      expiresAtText: '',
      jsonRevision: databaseSync.jsonRevision || 0,
      githubCommitSha: databaseSync.githubCommitSha || ''
    };
  } catch (error) {
    console.error(error);

    return {
      success: false,
      message: error.message || '設計師圖片設定失敗'
    };
  }
}

/**
 * 將一張或多張圖片加入限時動態。
 * 同一批圖片共用本次選擇的到期時間，但每張圖都有獨立到期紀錄。
 */
function setDesignerStories(payload) {
  try {
    payload = payload || {};
    verifyMediaManager_(payload.editorToken);
    const target = getUploadTarget_(payload.designer);
    const durationMinutes = normalizeStoryDuration_(payload.durationMinutes);
    const fileIds = Array.from(new Set(
      (Array.isArray(payload.fileIds) ? payload.fileIds : [])
        .map(function (fileId) {
          return String(fileId || '').trim();
        })
        .filter(Boolean)
    ));

    if (!fileIds.length) throw new Error('請先選取至少一張圖片');
    if (fileIds.length > RECENT_FILE_LIMIT) {
      throw new Error(`一次最多可設定 ${RECENT_FILE_LIMIT} 張限時動態`);
    }

    const files = fileIds.map(function (fileId) {
      return getAuthorizedUploadedFile_(fileId, target.folderId);
    });
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const reelsContext = getReelsSheetContext_();
      const imageUrls = files.map(function (file) {
        return createUploadedImageUrl_(file.getId());
      });
      const expiresAt = durationMinutes > 0
        ? Date.now() + durationMinutes * 60 * 1000
        : 0;

      files.forEach(function (file, index) {
        upsertDesignerReel_(
          reelsContext,
          target.key,
          file.getId(),
          imageUrls[index],
          expiresAt
        );
      });

      let records = readStoryExpirations_().filter(function (record) {
        return !fileIds.includes(record.fileId);
      });

      if (expiresAt) {
        fileIds.forEach(function (fileId) {
          records.push({
            designer: target.key,
            fileId: fileId,
            expiresAt: expiresAt
          });
        });
      }

      writeStoryExpirations_(records);
      scheduleNextStoryExpiration_(records);
      SpreadsheetApp.flush();

      const databaseSync = callMainAppJsonAction_(
        'upsertDesignerStories',
        {
          editorToken: payload.editorToken,
          designer: target.key,
          fileIds: fileIds,
          imageUrls: imageUrls,
          expiresAt: expiresAt
        }
      );

      return {
        success: true,
        designer: target.key,
        kind: 'story',
        header: '限時動態連結',
        count: fileIds.length,
        fileIds: fileIds,
        imageUrls: files.map(function (file) {
          return createUploadedImageUrl_(file.getId());
        }),
        expiresAt: expiresAt,
        expiresAtText: expiresAt
          ? Utilities.formatDate(
              new Date(expiresAt),
              Session.getScriptTimeZone(),
              'yyyy/MM/dd HH:mm:ss'
            )
          : '',
        jsonRevision: databaseSync.jsonRevision || 0,
        githubCommitSha: databaseSync.githubCommitSha || ''
      };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.message || '限時動態設定失敗'
    };
  }
}

/**
 * 取消選取圖片的限時動態設定，但保留 Google Drive 原始圖片。
 */
function unsetDesignerStories(payload) {
  try {
    payload = payload || {};
    verifyMediaManager_(payload.editorToken);
    const target = getUploadTarget_(payload.designer);
    const fileIds = Array.from(new Set(
      (Array.isArray(payload.fileIds) ? payload.fileIds : [])
        .map(function (fileId) {
          return String(fileId || '').trim();
        })
        .filter(Boolean)
    ));

    if (!fileIds.length) throw new Error('請先選取至少一張圖片');
    if (fileIds.length > RECENT_FILE_LIMIT) {
      throw new Error(`一次最多可取消 ${RECENT_FILE_LIMIT} 張限時動態`);
    }

    // 驗證每張圖片都屬於目前設計師，取消時不移到垃圾桶。
    fileIds.forEach(function (fileId) {
      getAuthorizedUploadedFile_(fileId, target.folderId);
    });

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const removedCount = removeDesignerReelsByFileIds_(fileIds, target.key);
      const records = readStoryExpirations_().filter(function (record) {
        return !fileIds.includes(record.fileId);
      });
      writeStoryExpirations_(records);
      scheduleNextStoryExpiration_(records);
      SpreadsheetApp.flush();

      const databaseSync = callMainAppJsonAction_(
        'deleteDesignerStories',
        {
          editorToken: payload.editorToken,
          designer: target.key,
          fileIds: fileIds
        }
      );

      return {
        success: true,
        designer: target.key,
        kind: 'story-cancel',
        count: fileIds.length,
        removedCount: Math.max(
          removedCount,
          Number(databaseSync.deleted) || 0
        ),
        fileIds: fileIds,
        jsonRevision: databaseSync.jsonRevision || 0,
        githubCommitSha: databaseSync.githubCommitSha || ''
      };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.message || '取消限時動態設定失敗'
    };
  }
}

/**
 * 刪除選取圖片，並清除同一設計師設定列中引用該檔案的連結。
 */
function deleteDesignerImage(payload) {
  payload = payload || {};
  const response = deleteDesignerImages({
    designer: payload.designer,
    fileIds: [payload.fileId],
    editorToken: payload.editorToken
  });
  if (response && response.success) {
    response.fileId = response.fileIds[0];
  }
  return response;
}

/**
 * 批次刪除選取圖片，並只清除試算表中引用這些檔案的連結。
 */
function deleteDesignerImages(payload) {
  try {
    payload = payload || {};
    verifyMediaManager_(payload.editorToken);
    const target = getUploadTarget_(payload.designer);
    const fileIds = Array.from(new Set(
      (Array.isArray(payload.fileIds) ? payload.fileIds : [])
        .map(function (fileId) {
          return String(fileId || '').trim();
        })
        .filter(Boolean)
    ));

    if (!fileIds.length) throw new Error('請先選取至少一張圖片');
    if (fileIds.length > RECENT_FILE_LIMIT) {
      throw new Error(`一次最多可刪除 ${RECENT_FILE_LIMIT} 張圖片`);
    }

    const files = fileIds.map(function (fileId) {
      return getAuthorizedUploadedFile_(fileId, target.folderId);
    });
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const context = getDesignerSheetContext_(target);

      ['頭像連結', '頭像大圖連結'].forEach(function (header) {
        const column = findHeaderColumn_(context.headers, [header]);
        if (!column) return;
        const cell = context.sheet.getRange(context.rowNumber, column);
        const value = String(cell.getDisplayValue() || '');
        if (fileIds.some(function (fileId) {
          return value.includes(fileId);
        })) {
          cell.clearContent();
        }
      });

      removeDesignerReelsByFileIds_(fileIds);

      const records = readStoryExpirations_().filter(function (record) {
        return !fileIds.includes(record.fileId);
      });
      writeStoryExpirations_(records);
      scheduleNextStoryExpiration_(records);
      files.forEach(function (file) {
        file.setTrashed(true);
      });
      SpreadsheetApp.flush();

      const databaseSync = callMainAppJsonAction_('deleteDesignerMediaFiles', {
        editorToken: payload.editorToken,
        designer: target.key,
        fileIds: fileIds
      });

      return {
        success: true,
        designer: target.key,
        count: fileIds.length,
        fileIds: fileIds,
        cleared: databaseSync.cleared || [],
        deletedStories: Number(databaseSync.deletedStories) || 0,
        jsonRevision: databaseSync.jsonRevision || 0,
        githubCommitSha: databaseSync.githubCommitSha || '',
        message: fileIds.length > 1
          ? `${fileIds.length} 張圖片已刪除`
          : '圖片已刪除'
      };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return {
      success: false,
      message: error.message || '圖片刪除失敗'
    };
  }
}

/**
 * 時間觸發器入口：清除到期限時動態並刪除照片。
 */
function expireDesignerStories_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const now = Date.now();
    const records = readStoryExpirations_();
    const future = records.filter(function (record) {
      return Number(record.expiresAt) > now;
    });
    const retry = [];

    records
      .filter(function (record) {
        return Number(record.expiresAt) <= now;
      })
      .forEach(function (record) {
        try {
          expireDesignerStory_(record);
        } catch (error) {
          // 保留失敗紀錄並稍後重試，避免暫時性的 Drive 或試算表錯誤
          // 讓限時動態永遠不會再被清理。
          retry.push({
            designer: record.designer,
            fileId: record.fileId,
            expiresAt: now + 5 * 60 * 1000
          });
          console.error('限時動態到期處理失敗，將於 5 分鐘後重試', record, error);
        }
      });

    SpreadsheetApp.flush();
    const remaining = future.concat(retry);
    writeStoryExpirations_(remaining);
    scheduleNextStoryExpiration_(remaining);
  } finally {
    lock.releaseLock();
  }
}

function expireDesignerStory_(record) {
  const target = getUploadTarget_(record.designer);
  const context = getDesignerSheetContext_(target);
  const avatarColumn = findHeaderColumn_(context.headers, ['頭像連結']);
  const posterColumn = findHeaderColumn_(context.headers, ['頭像大圖連結']);

  // 到期只停止在前台顯示（限時動態連結欄的「到期時間」已經是過去時間），
  // 不再刪除 reels 資料列，保留歷史紀錄供後台查詢。

  const usedAsAvatar = avatarColumn && String(
    context.sheet.getRange(context.rowNumber, avatarColumn).getDisplayValue() || ''
  ).includes(record.fileId);
  const usedAsPoster = posterColumn && String(
    context.sheet.getRange(context.rowNumber, posterColumn).getDisplayValue() || ''
  ).includes(record.fileId);

  // 若同一張圖後來被設定成頭像或海報，只清除限時動態，不刪檔。
  if (!usedAsAvatar && !usedAsPoster) {
    const file = getAuthorizedUploadedFile_(record.fileId, target.folderId);
    file.setTrashed(true);
  }
}

function getDesignerSheetContext_(target) {
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(DESIGNER_SPREADSHEET_ID);
  } catch (error) {
    const message = String(error && error.message || error || '');
    if (/SpreadsheetApp|spreadsheets|權限|permission|authorization/i.test(message)) {
      throw new Error(
        '上傳程式尚未取得試算表權限。請在 Apps Script 編輯器手動執行 authorizeUploadAppOnce，完成授權後重新部署。'
      );
    }
    throw error;
  }

  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getSheetId() === DESIGNER_SHEET_ID;
  });
  if (!sheet) throw new Error('找不到設計師設定工作表');

  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });
  const nameColumn = findHeaderColumn_(headers, ['名字', '設計師名字', '姓名']);
  if (!nameColumn) throw new Error('設定表缺少「名字」欄位');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('設計師設定表沒有資料');
  const names = sheet
    .getRange(2, nameColumn, lastRow - 1, 1)
    .getDisplayValues()
    .flat();
  const rowIndex = names.findIndex(function (value) {
    return String(value || '').trim().toLowerCase() === target.key.toLowerCase();
  });
  if (rowIndex < 0) throw new Error(`設定表找不到 ${target.key}`);

  return {
    spreadsheet: spreadsheet,
    sheet: sheet,
    headers: headers,
    rowNumber: rowIndex + 2
  };
}

function getReelsSheetContext_() {
  const spreadsheet = SpreadsheetApp.openById(DESIGNER_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getSheetId() === REELS_SHEET_ID;
  });
  if (!sheet) throw new Error('找不到 reels 工作表');

  const lastColumn = Math.max(sheet.getLastColumn(), REELS_HEADERS.length);
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });
  const headerMap = {};
  REELS_HEADERS.forEach(function (header) {
    headerMap[header] = ensureHeaderColumn_(sheet, headers, header);
  });

  return {
    spreadsheet: spreadsheet,
    sheet: sheet,
    headers: headers,
    headerMap: headerMap
  };
}

function upsertDesignerReel_(context, designer, fileId, imageUrl, expiresAt) {
  const sheet = context.sheet;
  const linkColumn = context.headerMap['限時動態連結'];
  const lastRow = sheet.getLastRow();
  let rowNumber = 0;

  if (lastRow >= 2) {
    const links = sheet
      .getRange(2, linkColumn, lastRow - 1, 1)
      .getDisplayValues()
      .flat();
    const index = links.findIndex(function (value) {
      return String(value || '').includes(fileId);
    });
    if (index >= 0) rowNumber = index + 2;
  }

  if (!rowNumber) rowNumber = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(rowNumber, context.headerMap['名字']).setValue(designer);
  sheet.getRange(rowNumber, linkColumn).setValue(imageUrl);
  sheet.getRange(rowNumber, context.headerMap['保留期限']).setValue(expiresAt ? '24小時' : '永久');
  sheet.getRange(rowNumber, context.headerMap['到期時間']).setValue(expiresAt ? new Date(expiresAt).toISOString() : '');
  return rowNumber;
}

function removeDesignerReelsByFileIds_(fileIds, designer) {
  const ids = Array.from(new Set((fileIds || []).map(String).filter(Boolean)));
  if (!ids.length) return 0;
  const context = getReelsSheetContext_();
  const sheet = context.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  const links = sheet
    .getRange(2, context.headerMap['限時動態連結'], lastRow - 1, 1)
    .getDisplayValues()
    .flat();
  const names = sheet
    .getRange(2, context.headerMap['名字'], lastRow - 1, 1)
    .getDisplayValues()
    .flat();
  const requestedDesigner = String(designer || '').trim().toLowerCase();
  const rowsToDelete = [];
  links.forEach(function (value, index) {
    if (requestedDesigner && String(names[index] || '').trim().toLowerCase() !== requestedDesigner) {
      return;
    }
    if (ids.some(function (fileId) {
      return String(value || '').includes(fileId);
    })) {
      rowsToDelete.push(index + 2);
    }
  });
  rowsToDelete.reverse().forEach(function (rowNumber) {
    sheet.deleteRow(rowNumber);
  });
  return rowsToDelete.length;
}

function getUserSheetContext_(user, account) {
  const base = getSettingsSheetBase_();
  const headers = base.headers;
  const accountColumn = findHeaderColumn_(headers, [
    '帳號',
    'Email',
    'email'
  ]);
  const nameColumn = findHeaderColumn_(headers, [
    '名字',
    '設計師名字',
    '姓名'
  ]);

  if (!nameColumn) throw new Error('設定表缺少「名字」欄位');
  if (!accountColumn) throw new Error('設定表缺少「帳號」欄位');

  const requestedAccount = normalizeUserAccount_(account);
  const requestedUser = String(user || '').trim().toLowerCase();
  const lastRow = base.sheet.getLastRow();
  if (lastRow < 2) throw new Error('設定表沒有使用者資料');

  const values = base.sheet
    .getRange(2, 1, lastRow - 1, Math.max(headers.length, 1))
    .getDisplayValues();
  let rowIndex = -1;

  if (requestedAccount) {
    rowIndex = values.findIndex(function (row) {
      return normalizeUserAccount_(row[accountColumn - 1]) ===
        requestedAccount;
    });
    if (rowIndex < 0) {
      throw new Error('設定表找不到此使用者帳號');
    }
  } else if (requestedUser) {
    rowIndex = values.findIndex(function (row) {
      return String(row[nameColumn - 1] || '').trim().toLowerCase() ===
        requestedUser;
    });
  }

  if (rowIndex < 0) throw new Error('設定表找不到此使用者');
  const row = values[rowIndex];
  const resolvedName = sanitizeUserFolderName_(row[nameColumn - 1]);
  const resolvedAccount = normalizeUserAccount_(row[accountColumn - 1]);
  if (!resolvedName) throw new Error('此使用者尚未設定名字');

  return {
    spreadsheet: base.spreadsheet,
    sheet: base.sheet,
    headers: headers,
    rowNumber: rowIndex + 2,
    user: resolvedName,
    account: resolvedAccount
  };
}

function getSettingsSheetBase_() {
  let spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(DESIGNER_SPREADSHEET_ID);
  } catch (error) {
    throw new Error(
      '上傳程式尚未取得試算表權限，請先執行 authorizeUploadAppOnce。'
    );
  }
  const sheet = spreadsheet.getSheets().find(function (candidate) {
    return candidate.getSheetId() === DESIGNER_SHEET_ID;
  });
  if (!sheet) throw new Error('找不到設定工作表');
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (value) {
      return String(value || '').trim();
    });
  return {
    spreadsheet: spreadsheet,
    sheet: sheet,
    headers: headers
  };
}

function ensureHeaderColumn_(sheet, headers, header) {
  const existing = findHeaderColumn_(headers, [header]);
  if (existing) return existing;
  const column = headers.length + 1;
  sheet.getRange(1, column).setValue(header);
  headers.push(header);
  return column;
}

function createUploadedImageUrl_(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}=w1600`;
}

function callMainAppJsonAction_(action, payload) {
  payload = payload || {};
  const editorToken = String(payload.editorToken || '').trim();
  const serviceKey = String(payload.serviceKey || '').trim();
  if (!editorToken && !serviceKey) {
    throw new Error('登入狀態已失效，請回主系統重新開啟圖片管理');
  }

  let response;
  try {
    response = UrlFetchApp.fetch(MAIN_APP_API_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(Object.assign({}, payload, {
        action: action
      })),
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (error) {
    throw new Error(
      'JSON 資料庫同步失敗：' +
      String(error && error.message || error || '無法連線主系統')
    );
  }

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('JSON 資料庫同步回應格式錯誤');
  }
  if (
    response.getResponseCode() < 200 ||
    response.getResponseCode() >= 300 ||
    !result ||
    !result.ok
  ) {
    throw new Error(
      result && (result.error || result.reason) ||
      `JSON 資料庫同步失敗（HTTP ${response.getResponseCode()}）`
    );
  }
  return result;
}

function normalizeStoryDuration_(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('限時動態時間格式錯誤');
  }
  return Math.round(minutes);
}

function removeStoryExpirationsForFile_(fileId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const records = readStoryExpirations_().filter(function (record) {
      return record.fileId !== fileId;
    });
    writeStoryExpirations_(records);
    scheduleNextStoryExpiration_(records);
  } finally {
    lock.releaseLock();
  }
}

function readStoryExpirations_() {
  const raw = PropertiesService.getScriptProperties().getProperty(
    STORY_EXPIRATIONS_PROPERTY
  );
  if (!raw) return [];
  try {
    const records = JSON.parse(raw);
    return Array.isArray(records) ? records : [];
  } catch (error) {
    return [];
  }
}

function writeStoryExpirations_(records) {
  PropertiesService.getScriptProperties().setProperty(
    STORY_EXPIRATIONS_PROPERTY,
    JSON.stringify(records || [])
  );
}

function scheduleNextStoryExpiration_(records) {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === STORY_EXPIRATION_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  if (!records || !records.length) return;
  const nextTime = Math.min.apply(null, records.map(function (record) {
    return Number(record.expiresAt);
  }));
  ScriptApp
    .newTrigger(STORY_EXPIRATION_HANDLER)
    .timeBased()
    .at(new Date(Math.max(nextTime, Date.now() + 5000)))
    .create();
}

function getAuthorizedUploadedFile_(fileId, folderId) {
  if (!fileId) throw new Error('缺少已上傳圖片 ID');

  const file = DriveApp.getFileById(fileId);
  const mimeType = String(file.getMimeType() || '');
  if (!mimeType.startsWith('image/')) {
    throw new Error('指定檔案不是圖片');
  }

  const parents = file.getParents();
  let belongsToTargetFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) {
      belongsToTargetFolder = true;
      break;
    }
  }

  if (!belongsToTargetFolder) {
    throw new Error('圖片不在目前設計師的指定資料夾');
  }

  return file;
}

function findHeaderColumn_(headers, aliases) {
  const index = headers.findIndex(function (header) {
    return aliases.includes(header);
  });
  return index < 0 ? 0 : index + 1;
}

/**
 * 依前台 key 取得核准的上傳目標。
 */
function getUploadTarget_(targetKey) {
  const requestedKey = String(targetKey || '').trim();
  const matchedKey = Object.keys(UPLOAD_TARGETS).find(function (key) {
    return key.toLowerCase() === requestedKey.toLowerCase();
  });

  if (!matchedKey) {
    throw new Error('指定的上傳資料夾不存在');
  }

  return {
    mode: 'designer',
    key: matchedKey,
    name: UPLOAD_TARGETS[matchedKey].name,
    folderId: UPLOAD_TARGETS[matchedKey].folderId
  };
}

function getUploadTargetFromContext_(context) {
  if (context && typeof context === 'object') {
    const mode = String(context.mode || '').trim().toLowerCase();
    if (mode === 'user') {
      return getUserUploadTarget_(
        context.user,
        context.account,
        context.editorToken
      );
    }
    verifyMediaManager_(context.editorToken);
    return getUploadTarget_(context.designer);
  }
  return getUploadTarget_(context);
}

function getUserUploadTarget_(user, account, editorToken, resolveFolder) {
  const identity = verifyUserUploadIdentity_(editorToken);
  const requestedAccount = normalizeUserAccount_(account);
  if (requestedAccount && requestedAccount !== identity.account) {
    throw new Error('登入帳號與頭像設定目標不符');
  }
  const resolvedName = sanitizeUserFolderName_(identity.user || user);
  const folderName = userFolderNameFromAccount_(identity.account);
  const target = {
    mode: 'user',
    key: identity.account || resolvedName,
    name: resolvedName,
    account: identity.account,
    folderName: folderName,
    folderId: ''
  };
  if (resolveFolder === false) return target;
  const folder = getOrCreateUserFolder_(folderName);
  target.folderId = folder.getId();
  return target;
}

function verifyUserUploadIdentity_(editorToken) {
  const token = String(editorToken || '').trim();
  if (!token) throw new Error('頭像設定連結已失效，請回主系統重新開啟');

  const cache = CacheService.getScriptCache();
  const cacheKey = 'user-identity:' + cacheKeyDigest_(token);
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const identity = JSON.parse(cached);
      if (identity.user && identity.account) return identity;
    } catch (error) {}
  }

  const url = MAIN_APP_API_URL +
    '?action=verifyToken&editorToken=' + encodeURIComponent(token) +
    '&ts=' + Date.now();
  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (error) {
    const message = String(error && error.message || error || '');
    if (/UrlFetchApp|external_request|權限|permission|authorization/i.test(message)) {
      throw new Error(
        '上傳程式尚未取得主系統連線權限，請由管理者執行 authorizeUploadAppOnce 後重新部署'
      );
    }
    throw new Error(
      '無法驗證主系統登入狀態：' +
      (message || '未知連線錯誤')
    );
  }

  let result;
  try {
    result = JSON.parse(response.getContentText());
  } catch (error) {
    throw new Error('主系統登入驗證回應格式錯誤');
  }
  if (!result || !result.ok || !result.user || !result.account) {
    throw new Error('登入狀態已過期，請回主系統重新登入');
  }
  const identity = {
    user: String(result.user || '').trim(),
    account: normalizeUserAccount_(result.account)
  };
  cache.put(cacheKey, JSON.stringify(identity), USER_IDENTITY_CACHE_SECONDS);
  return identity;
}

function verifyMediaManager_(editorToken) {
  const token = String(editorToken || '').trim();
  if (!token) throw new Error('圖片管理連結已失效，請回主系統重新開啟');
  const response = UrlFetchApp.fetch(MAIN_APP_API_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ action: 'verifyToken', editorToken: token }),
    muteHttpExceptions: true,
    followRedirects: true
  });
  let result = {};
  try { result = JSON.parse(response.getContentText()); }
  catch (error) { throw new Error('Cloudflare Worker 登入驗證回應格式錯誤'); }
  const capabilities = result && result.access && Array.isArray(result.access.capabilities)
    ? result.access.capabilities
    : [];
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || !result.ok || capabilities.indexOf('media.manage') < 0) {
    throw new Error(result.error || '此帳號沒有圖片與 Reels 管理權限');
  }
  return result;
}

function getOrCreateUserFolder_(userName) {
  const folderName = sanitizeUserFolderName_(userName);
  if (!folderName) throw new Error('無法取得使用者資料夾名稱');
  const cache = CacheService.getScriptCache();
  const cacheKey = 'user-folder:' + cacheKeyDigest_(folderName);
  const cachedFolderId = cache.get(cacheKey);
  if (cachedFolderId) {
    try {
      return DriveApp.getFolderById(cachedFolderId);
    } catch (error) {
      cache.remove(cacheKey);
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const root = DriveApp.getFolderById(USER_UPLOAD_ROOT_FOLDER_ID);
    const existing = root.getFoldersByName(folderName);
    const folder = existing.hasNext()
      ? existing.next()
      : root.createFolder(folderName);
    cache.put(cacheKey, folder.getId(), USER_FOLDER_CACHE_SECONDS);
    return folder;
  } finally {
    lock.releaseLock();
  }
}

function cacheKeyDigest_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '').slice(0, 40);
}

function normalizeUserAccount_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text.indexOf('@') >= 0 ? text : `${text}@emctaipei.com`;
}

function userFolderNameFromAccount_(account) {
  const normalizedAccount = normalizeUserAccount_(account);
  const localPart = normalizedAccount.split('@')[0];
  const folderName = sanitizeUserFolderName_(localPart);
  if (!folderName) throw new Error('無法從使用者帳號取得資料夾名稱');
  return folderName;
}

function sanitizeUserFolderName_(value) {
  return String(value || '')
    .replace(/[\\/\x00-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 80);
}

function createFolderUrl_(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * 驗證前台傳入資料。
 */
function validatePayload_(payload) {
  if (!payload) {
    throw new Error('沒有收到圖片資料');
  }

  if (!payload.fileName) {
    throw new Error('缺少圖片名稱');
  }

  if (!payload.mimeType || !payload.mimeType.startsWith('image/')) {
    throw new Error('只允許上傳圖片檔案');
  }

  if (!payload.base64) {
    throw new Error('沒有收到圖片內容');
  }

  const mode = String(payload.mode || '').trim().toLowerCase();
  if (mode === 'user') {
    if (!payload.account && !payload.user) {
      throw new Error('缺少使用者帳號參數');
    }
    if (!payload.editorToken) {
      throw new Error('頭像設定連結已失效，請回主系統重新開啟');
    }
  } else {
    if (!payload.designer) throw new Error('缺少設計師參數');
    if (!payload.editorToken) throw new Error('圖片管理連結已失效，請回主系統重新開啟');
  }

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif'
  ];

  if (!allowedTypes.includes(payload.mimeType)) {
    throw new Error('僅支援 JPG、PNG、WebP、GIF');
  }
}

/**
 * 移除 data:image/jpeg;base64, 前綴。
 */
function removeDataUrlPrefix_(dataUrl) {
  const commaIndex = dataUrl.indexOf(',');

  if (commaIndex === -1) {
    return dataUrl;
  }

  return dataUrl.substring(commaIndex + 1);
}

/**
 * 建立安全且不重複的檔案名稱。
 */
function createFileName_(originalName, extension) {
  const originalBase = originalName
    .replace(/\.[^/.]+$/, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40) || 'image';

  const now = new Date();

  const dateText = Utilities.formatDate(
    now,
    Session.getScriptTimeZone(),
    'yyyyMMdd-HHmmss'
  );

  const randomText = Math.random()
    .toString(36)
    .substring(2, 7);

  return `${dateText}-${originalBase}-${randomText}.${extension}`;
}

/**
 * 根據檔案名稱或 MIME Type 判斷副檔名。
 */
function getExtension_(fileName, mimeType) {
  const nameMatch = String(fileName || '')
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);

  if (nameMatch) {
    const extension = nameMatch[1];

    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
      return extension === 'jpeg' ? 'jpg' : extension;
    }
  }

  const mimeMap = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
  };

  return mimeMap[mimeType] || 'jpg';
}

/**
 * 將 bytes 轉為易讀格式。
 */
function formatFileSize_(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
