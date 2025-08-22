/**
 * 주문 수집 시스템 API (Google Apps Script)
 *
 * 기능:
 * - action=submit: 주문목록에 주문번호와 고객정보 저장
 * - action=getOrders: 관리자용 주문 목록 조회 (이번 달만)
 * - JSONP 지원: callback 파라미터로 크로스도메인 호출 가능
 * - 자동 데이터 정리: 1주일이 지난 주문 데이터 자동 삭제
 *
 * 설정:
 * 1) SPREADSHEET_ID: 구글 스프레드시트 ID 입력
 * 2) SHEET_NAME_ORDERS: 주문 저장 시트명 입력
 * 3) 웹앱으로 배포 후 생성된 URL을 index.html의 API_URL에 입력
 * 4) setupDataCleanupTrigger() 함수를 한 번 실행하여 자동 정리 트리거 설정
 */

const SPREADSHEET_ID = "1t827-32lLymCf4jGVP--_mbYv1jSC5xFtcV2q2BR3SI"; // 구글 스프레드시트 ID를 여기에 입력하세요
const SHEET_NAME_ORDERS = "시트1"; // 주문 저장 시트명을 여기에 입력하세요

/**
 * Google Apps Script는 이미 한국 시간대로 실행되므로
 * 단순히 현재 시간을 반환합니다.
 */
function getCurrentDateTime() {
    return new Date();
}

/**
 * 정확한 날짜 범위 계산 (시간대 안전)
 * @param {number} days - 일수
 * @returns {Object} {start, end} - 시작일과 종료일
 */
function calculateDateRange(days) {
    const now = getKoreanDateTime();

    // 정확한 N일 전 계산 (시간대 고려)
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(now.getTime());
    endDate.setHours(23, 59, 59, 999);

    return { start: startDate, end: endDate };
}

/**
 * 안전한 날짜 파싱 (에러 처리 포함)
 * @param {string} dateString - 날짜 문자열
 * @returns {Date|null} 파싱된 날짜 또는 null
 */
function safeParseDate(dateString) {
    if (!dateString) return null;

    try {
        const date = new Date(dateString);
        // 유효한 날짜인지 확인
        if (isNaN(date.getTime())) {
            console.warn(`Invalid date string: ${dateString}`);
            return null;
        }
        return date;
    } catch (error) {
        console.error(`Date parsing error: ${error.message}`);
        return null;
    }
}

function doGet(e) {
    try {
        const params = (e && e.parameter) || {};
        const action = params.action || "";
        const callback = params.callback; // JSONP 지원

        let response = {
            status: "error",
            message: "지원하지 않는 요청입니다.",
        };

        if (action === "submit") {
            let data = {};
            if (params.data) {
                try {
                    data = JSON.parse(params.data);
                } catch (err) {
                    response = {
                        status: "error",
                        message: "data 파라미터 JSON 파싱 실패",
                    };
                }
            }
            if (!data || Object.keys(data).length === 0) {
                response =
                    response.status === "error"
                        ? response
                        : {
                              status: "error",
                              message: "data 파라미터가 필요합니다.",
                          };
            } else {
                response = handleSubmit(data, params);
            }
        } else if (action === "getOrders") {
            response = handleGetOrders(params);
        } else if (action === "getOrdersByDateRange") {
            response = handleGetOrdersByDateRange(params);
        } else if (action === "ping") {
            response = {
                status: "success",
                message: "ok",
                timestamp: new Date().toISOString(),
            };
        }

        // JSONP 응답
        if (callback && callback.length > 0) {
            const payload = `${callback}(${JSON.stringify(response)})`;
            return ContentService.createTextOutput(payload).setMimeType(
                ContentService.MimeType.JAVASCRIPT
            );
        }

        // JSON 응답
        return ContentService.createTextOutput(
            JSON.stringify(response)
        ).setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        const errRes = {
            status: "error",
            message: error && error.message ? error.message : String(error),
        };
        const cb = e && e.parameter && e.parameter.callback;
        if (cb) {
            const payload = `${cb}(${JSON.stringify(errRes)})`;
            return ContentService.createTextOutput(payload).setMimeType(
                ContentService.MimeType.JAVASCRIPT
            );
        }
        return ContentService.createTextOutput(
            JSON.stringify(errRes)
        ).setMimeType(ContentService.MimeType.JSON);
    }
}

function handleGetOrders(params) {
    const ordersSheetName = getOrdersSheetName_(params);
    const sheet = getOrCreateSheet_(ordersSheetName);
    ensureHeaders_(sheet, [
        "주문번호",
        "입금자명",
        "연락처",
        "구매제품",
        "주소",
        "상세주소",
        "주문시간",
    ]);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
        return { status: "success", orders: [], hasMore: false, totalCount: 0 };
    }

    // 페이지네이션 파라미터
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 10;
    const offset = (page - 1) * limit;

    // 성능 최적화: 한 번에 모든 데이터 가져오기
    const range = sheet.getRange(2, 1, lastRow - 1, 7);
    const values = range.getValues();

    // 최근 3일간의 주문만 조회 (시간대 안전 처리)
    // 최근 3일간의 주문만 조회 (Google Apps Script는 이미 한국시간으로 실행됨)
    const now = new Date();

    // 3일 전 00:00:00
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    threeDaysAgo.setHours(0, 0, 0, 0);

    // 현재 시간
    const currentTime = new Date();

    // 성능 최적화: map과 filter를 한 번에 처리
    const allOrders = [];
    for (let i = 0; i < values.length; i++) {
        const r = values[i];
        const orderTime = r[6] ? new Date(r[6]) : null;

        // 최근 3일간 주문만 필터링
        if (
            orderTime &&
            orderTime >= threeDaysAgo &&
            orderTime <= currentTime
        ) {
            allOrders.push({
                orderNumber: r[0] != null ? String(r[0]) : "",
                depositorName: r[1] != null ? String(r[1]) : "",
                contact: r[2] != null ? String(r[2]) : "",
                product: r[3] != null ? String(r[3]) : "",
                address: r[4] != null ? String(r[4]) : "",
                addressDetail: r[5] != null ? String(r[5]) : "",
                orderTime: orderTime,
            });
        }
    }

    // 최신 주문부터 정렬 (최신순)
    allOrders.sort((a, b) => new Date(b.orderTime) - new Date(a.orderTime));

    // 페이지네이션 적용
    const totalCount = allOrders.length;
    const hasMore = offset + limit < totalCount;
    const orders = allOrders.slice(offset, offset + limit);

    return {
        status: "success",
        orders: orders,
        hasMore: hasMore,
        totalCount: totalCount,
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
    };
}

/**
 * 기간별 주문 조회 (엑셀 내보내기용)
 * startDate, endDate 파라미터로 기간 지정 가능
 */
function handleGetOrdersByDateRange(params) {
    const ordersSheetName = getOrdersSheetName_(params);
    const sheet = getOrCreateSheet_(ordersSheetName);
    ensureHeaders_(sheet, [
        "주문번호",
        "입금자명",
        "연락처",
        "구매제품",
        "주소",
        "상세주소",
        "주문시간",
    ]);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
        return { status: "success", orders: [] };
    }

    // 기간 파라미터 처리 (안전한 날짜 파싱)
    let startDate = null;
    let endDate = null;

    if (params.startDate) {
        startDate = safeParseDate(params.startDate);
        if (startDate) {
            startDate.setHours(0, 0, 0, 0);
        }
    }

    if (params.endDate) {
        endDate = safeParseDate(params.endDate);
        if (endDate) {
            endDate.setHours(23, 59, 59, 999);
        }
    }

    // 날짜 유효성 검사
    if (startDate && endDate && startDate > endDate) {
        return {
            status: "error",
            message: "시작일은 종료일보다 이전이어야 합니다.",
            orders: [],
        };
    }

    // 성능 최적화: 한 번에 모든 데이터 가져오기
    const range = sheet.getRange(2, 1, lastRow - 1, 7);
    const values = range.getValues();

    // 기간별 필터링
    const allOrders = [];
    for (let i = 0; i < values.length; i++) {
        const r = values[i];
        const orderTime = r[6] ? new Date(r[6]) : null;

        // 기간 필터링
        let includeOrder = true;
        if (orderTime) {
            if (startDate && orderTime < startDate) {
                includeOrder = false;
            }
            if (endDate && orderTime > endDate) {
                includeOrder = false;
            }
        } else {
            includeOrder = false; // 주문시간이 없는 경우 제외
        }

        if (includeOrder) {
            allOrders.push({
                orderNumber: r[0] != null ? String(r[0]) : "",
                depositorName: r[1] != null ? String(r[1]) : "",
                contact: r[2] != null ? String(r[2]) : "",
                product: r[3] != null ? String(r[3]) : "",
                address: r[4] != null ? String(r[4]) : "",
                addressDetail: r[5] != null ? String(r[5]) : "",
                orderTime: orderTime,
            });
        }
    }

    // 최신 주문부터 정렬 (최신순)
    allOrders.sort((a, b) => new Date(b.orderTime) - new Date(a.orderTime));

    return {
        status: "success",
        orders: allOrders,
        totalCount: allOrders.length,
    };
}

function generateOrderNumber() {
    // 현재 시간 사용 (Google Apps Script는 이미 한국시간으로 실행됨)
    const now = new Date();

    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const second = String(now.getSeconds()).padStart(2, "0");
    const random = Math.floor(Math.random() * 1000)
        .toString()
        .padStart(3, "0");

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
        return {
            status: "error",
            message: `${errors.join(", ")}을(를) 입력해주세요.`,
        };
    }

    const ordersSheetName = getOrdersSheetName_(params);
    const sheet = getOrCreateSheet_(ordersSheetName);
    ensureHeaders_(sheet, [
        "주문번호",
        "입금자명",
        "연락처",
        "구매제품",
        "주소",
        "상세주소",
        "주문시간",
    ]);

    const orderNumber = generateOrderNumber();
    const now = new Date();

    // 성능 최적화: 한 번에 데이터 추가
    sheet.appendRow([
        orderNumber,
        depositor,
        contact,
        product,
        address,
        addressDetail,
        now,
    ]);
    SpreadsheetApp.flush();

    return {
        status: "success",
        message: "주문이 성공적으로 접수되었습니다.",
        orderNumber: orderNumber,
    };
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
    if (
        params &&
        typeof params.ordersSheet === "string" &&
        params.ordersSheet.trim().length > 0
    ) {
        return params.ordersSheet.trim();
    }
    return SHEET_NAME_ORDERS;
}

/**
 * 1주일이 지난 주문 데이터를 자동으로 삭제하는 함수
 * 이 함수는 매일 자동으로 실행됩니다 (트리거 설정 필요)
 */
function cleanupOldOrders() {
    try {
        const sheet = getOrCreateSheet_(SHEET_NAME_ORDERS);
        const lastRow = sheet.getLastRow();

        if (lastRow < 2) {
            console.log("삭제할 데이터가 없습니다.");
            return;
        }

        // 1주일 전 날짜 계산 (Google Apps Script는 한국시간으로 실행됨)
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        oneWeekAgo.setHours(0, 0, 0, 0);

        console.log(
            `데이터 정리 시작: ${oneWeekAgo.toLocaleString(
                "ko-KR"
            )} 이전 데이터 삭제`
        );

        // 성능 최적화: 한 번에 모든 데이터 가져오기
        const range = sheet.getRange(2, 1, lastRow - 1, 7);
        const values = range.getValues();

        // 삭제할 행 번호들을 역순으로 저장 (아래에서부터 삭제해야 인덱스가 꼬이지 않음)
        const rowsToDelete = [];

        for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const orderTime = row[6] ? new Date(row[6]) : null;

            // 1주일이 지난 주문 데이터 찾기
            if (orderTime && orderTime < oneWeekAgo) {
                rowsToDelete.push(i + 2); // 실제 행 번호 (헤더 제외)
            }
        }

        // 역순으로 정렬 (아래에서부터 삭제)
        rowsToDelete.sort((a, b) => b - a);

        if (rowsToDelete.length === 0) {
            console.log("삭제할 데이터가 없습니다.");
            return;
        }

        // 삭제할 행들을 한 번에 삭제
        for (const rowNum of rowsToDelete) {
            sheet.deleteRow(rowNum);
        }

        console.log(
            `${rowsToDelete.length}개의 오래된 주문 데이터가 삭제되었습니다.`
        );

        // 변경사항 저장
        SpreadsheetApp.flush();
    } catch (error) {
        console.error("데이터 정리 중 오류 발생:", error);
    }
}

/**
 * 자동 데이터 정리 트리거를 설정하는 함수
 * 이 함수는 한 번만 실행하면 됩니다.
 */
function setupDataCleanupTrigger() {
    try {
        // 기존 트리거 삭제
        const triggers = ScriptApp.getProjectTriggers();
        for (const trigger of triggers) {
            if (trigger.getHandlerFunction() === "cleanupOldOrders") {
                ScriptApp.deleteTrigger(trigger);
                console.log("기존 데이터 정리 트리거가 삭제되었습니다.");
            }
        }

        // 새로운 트리거 생성 (매일 오전 2시에 실행)
        ScriptApp.newTrigger("cleanupOldOrders")
            .timeBased()
            .everyDays(1)
            .atHour(2)
            .create();

        console.log(
            "데이터 정리 트리거가 설정되었습니다. (매일 오전 2시 실행)"
        );
    } catch (error) {
        console.error("트리거 설정 중 오류 발생:", error);
    }
}

/**
 * 수동으로 데이터 정리를 실행하는 함수 (테스트용)
 */
function manualCleanup() {
    console.log("수동 데이터 정리 시작...");
    cleanupOldOrders();
    console.log("수동 데이터 정리 완료");
}
