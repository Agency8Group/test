/**
 * 셀러 주문 수집 목업 API (Google Apps Script)
 *
 * 기능:
 * - action=getProducts: 2시트(제품목록)에서 드롭다운 옵션 반환
 * - action=submit: 1시트(주문목록)에 [입금자명, 연락처, 구매제품, 주소, 상세주소] 저장
 * - JSONP 지원: callback 파라미터로 크로스도메인 호출 가능
 *
 * 사용 전 준비:
 * 1) 아래 SPREADSHEET_ID 를 실제 구글 스프레드시트 ID로 변경
 * 2) 1시트 이름(SHEET_NAME_ORDERS), 2시트 이름(SHEET_NAME_PRODUCTS) 확인/수정 가능
 * 3) 웹앱으로 배포 후, 생성된 URL을 index.html 의 API_URL 에 설정
 */

const SPREADSHEET_ID = "1t827-32lLymCf4jGVP--_mbYv1jSC5xFtcV2q2BR3SI"; // 제공해주신 스프레드시트 ID
const SHEET_NAME_ORDERS = "시트1"; // 주문 저장 시트 (입금자명, 연락처, 구매제품, 주소, 상세주소)
const SHEET_NAME_PRODUCTS = "시트2"; // 제품 목록 시트 (A열에 제품명 목록)

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || "";
    const callback = params.callback; // JSONP 지원

    let response = { status: "error", message: "지원하지 않는 요청입니다." };

    if (action === "getProducts") {
      response = handleGetProducts();
    } else if (action === "submit") {
      let data = {};
      if (params.data) {
        try {
          data = JSON.parse(params.data);
        } catch (err) {
          response = { status: "error", message: "data 파라미터 JSON 파싱 실패" };
        }
      }
      if (!data || Object.keys(data).length === 0) {
        response = response.status === "error" ? response : { status: "error", message: "data 파라미터가 필요합니다." };
      } else {
        response = handleSubmit(data);
      }
    } else if (action === "ping") {
      response = { status: "success", message: "ok", timestamp: new Date().toISOString() };
    }

    // JSONP 응답
    if (callback && callback.length > 0) {
      const payload = `${callback}(${JSON.stringify(response)})`;
      return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    // JSON 응답
    return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    const errRes = { status: "error", message: error && error.message ? error.message : String(error) };
    const cb = e && e.parameter && e.parameter.callback;
    if (cb) {
      const payload = `${cb}(${JSON.stringify(errRes)})`;
      return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errRes)).setMimeType(ContentService.MimeType.JSON);
  }
}

function handleGetProducts() {
  const sheet = getOrCreateSheet_(SHEET_NAME_PRODUCTS);

  // 헤더 보장
  ensureHeaders_(sheet, ["제품"]);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    // 최초 비어있으면 샘플 제품 자동 생성 (임시)
    const samples = [["샘플제품 A"],["샘플제품 B"],["샘플제품 C"]];
    sheet.getRange(2, 1, samples.length, 1).setValues(samples);
    SpreadsheetApp.flush();
    return { status: "success", products: samples.map(function(r){return r[0];}) };
  }

  const values = sheet.getRange(2, 1, lastRow - 2 + 1, 1).getValues();
  const products = values
    .map(function (r) { return (r && r[0] != null ? String(r[0]).trim() : ""); })
    .filter(function (name) { return name.length > 0; });

  return { status: "success", products: products };
}

function handleSubmit(data) {
  var depositor = (data.depositorName || "").trim();
  var contact = (data.contact || "").trim();
  var product = (data.product || "").trim();
  var address = (data.address || "").trim();
  var addressDetail = (data.addressDetail || "").trim();

  if (!depositor) {
    return { status: "error", message: "입금자명을 입력해주세요." };
  }
  if (!contact) {
    return { status: "error", message: "연락처를 입력해주세요." };
  }
  if (!product) {
    return { status: "error", message: "구매제품을 선택해주세요." };
  }
  if (!address) {
    return { status: "error", message: "주소를 입력해주세요." };
  }

  const sheet = getOrCreateSheet_(SHEET_NAME_ORDERS);
  ensureHeaders_(sheet, ["입금자명", "연락처", "구매제품", "주소", "상세주소"]);

  sheet.appendRow([depositor, contact, product, address, addressDetail]);
  SpreadsheetApp.flush();

  return { status: "success", message: "저장되었습니다." };
}

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function ensureHeaders_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  const current = range.getValues();
  const same = JSON.stringify(current[0]) === JSON.stringify(headers);
  if (!same) {
    range.setValues([headers]);
  }
}


