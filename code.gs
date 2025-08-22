/**
 * 주문 수집 시스템 API (Google Apps Script)
 *
 * 기능:
 * - action=submit: 주문목록에 주문번호와 고객정보 저장
 * - action=getOrders: 관리자용 주문 목록 조회 (이번 달만)
 * - JSONP 지원: callback 파라미터로 크로스도메인 호출 가능
 *
 * 설정:
 * 1) SPREADSHEET_ID: 구글 스프레드시트 ID 입력
 * 2) SHEET_NAME_ORDERS: 주문 저장 시트명 입력
 * 3) 웹앱으로 배포 후 생성된 URL을 index.html의 API_URL에 입력
 */

const SPREADSHEET_ID = "1t827-32lLymCf4jGVP--_mbYv1jSC5xFtcV2q2BR3SI"; // 구글 스프레드시트 ID를 여기에 입력하세요
const SHEET_NAME_ORDERS = "시트1"; // 주문 저장 시트명을 여기에 입력하세요

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || "";
    const callback = params.callback; // JSONP 지원

    let response = { status: "error", message: "지원하지 않는 요청입니다." };

    if (action === "submit") {
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
        response = handleSubmit(data, params);
      }
    } else if (action === "getOrders") {
      response = handleGetOrders(params);

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



function handleGetOrders(params) {
  const ordersSheetName = getOrdersSheetName_(params);
  const sheet = getOrCreateSheet_(ordersSheetName);
  ensureHeaders_(sheet, ["주문번호", "입금자명", "연락처", "구매제품", "주소", "상세주소", "주문시간"]);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { status: "success", orders: [] };
  }

  // 성능 최적화: 한 번에 모든 데이터 가져오기
  const range = sheet.getRange(2, 1, lastRow - 1, 7);
  const values = range.getValues();
  
  // 현재 월의 시작과 끝 계산 (Google Apps Script는 이미 한국시간으로 실행됨)
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  // 이번 달 1일 00:00:00
  const monthStart = new Date(currentYear, currentMonth, 1);
  
  // 다음 달 1일 00:00:00
  const nextMonthStart = new Date(currentYear, currentMonth + 1, 1);
  
  // 성능 최적화: map과 filter를 한 번에 처리
  const orders = [];
  for (let i = 0; i < values.length; i++) {
    const r = values[i];
    const orderTime = r[6] ? new Date(r[6]) : null;
    
    // 이번 달 주문만 필터링
    if (orderTime && orderTime >= monthStart && orderTime < nextMonthStart) {
      orders.push({
        orderNumber: r[0] != null ? String(r[0]) : "",
        depositorName: r[1] != null ? String(r[1]) : "",
        contact: r[2] != null ? String(r[2]) : "",
        product: r[3] != null ? String(r[3]) : "",
        address: r[4] != null ? String(r[4]) : "",
        addressDetail: r[5] != null ? String(r[5]) : "",
        orderTime: orderTime
      });
    }
  }

  return { status: "success", orders: orders };
}



function generateOrderNumber() {
  // 현재 시간 사용 (Google Apps Script는 이미 한국시간으로 실행됨)
  const now = new Date();
  
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  return `ORD${year}${month}${day}${hour}${minute}${second}${random}`;
}

function handleSubmit(data, params) {
  // 성능 최적화: 변수 선언 최소화
  const depositor = (data.depositorName || "").trim();
  const contact = (data.contact || "").trim();
  const product = (data.product || "").trim();
  const address = (data.address || "").trim();
  const addressDetail = (data.addressDetail || "").trim();

  // 빠른 유효성 검사
  if (!depositor || !contact || !product || !address) {
    const errors = [];
    if (!depositor) errors.push("입금자명");
    if (!contact) errors.push("연락처");
    if (!product) errors.push("구매제품");
    if (!address) errors.push("주소");
    return { status: "error", message: `${errors.join(", ")}을(를) 입력해주세요.` };
  }

  const ordersSheetName = getOrdersSheetName_(params);
  const sheet = getOrCreateSheet_(ordersSheetName);
  ensureHeaders_(sheet, ["주문번호", "입금자명", "연락처", "구매제품", "주소", "상세주소", "주문시간"]);

  const orderNumber = generateOrderNumber();
  const now = new Date();
  
  // 성능 최적화: 한 번에 데이터 추가
  sheet.appendRow([orderNumber, depositor, contact, product, address, addressDetail, now]);
  SpreadsheetApp.flush();

  return { status: "success", message: "주문이 성공적으로 접수되었습니다.", orderNumber: orderNumber };
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



function getOrdersSheetName_(params) {
  if (params && typeof params.ordersSheet === 'string' && params.ordersSheet.trim().length > 0) {
    return params.ordersSheet.trim();
  }
  return SHEET_NAME_ORDERS;
}




