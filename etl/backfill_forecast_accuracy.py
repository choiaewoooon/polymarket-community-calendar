"""
기상청 예보 정확도 수집 스크립트
- 모드 1 (capture): 당일/내일 KMA 예보 최고기온을 Supabase에 저장 (마감 전 실행)
- 모드 2 (resolve): 마감된 날짜의 WU 실측 최고기온을 조회하여 오차 계산 (마감 후 실행)
- KMA API는 최근 3일만 제공하므로, 예보는 매일 캡처해서 보관해야 함
"""

import os
import sys
import requests
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# ─── 설정 ───

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
KMA_AUTH_KEY = os.getenv("KMA_AUTH_KEY", "16tey01xR-irXstNcTfo0w")
WU_API_KEY = os.getenv("WU_API_KEY", "e1f10a1e78da46f5b10a1e78da96f525")

# 서울 인천공항 격자 좌표 (KMA 단기예보)
KMA_NX = 55
KMA_NY = 124

# WU 관측소
WU_STATION = "RKSI:9:KR"

KST = timezone(timedelta(hours=9))


def get_supabase() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL, SUPABASE_KEY 환경변수 필요")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def fetch_kma_forecast_high(target_date: datetime, use_today_base: bool = False) -> "float | None":
    """
    KMA API 허브에서 단기예보의 최고기온 추출.
    use_today_base=True: 오늘 05시 발표 기준 (캡처용)
    use_today_base=False: 전날 05시 발표 기준 (백필용)
    """
    if use_today_base:
        now_kst = datetime.now(KST)
        base_date = now_kst
        # 현재 시간 기준 가장 최근 발표시각 사용
        hour = now_kst.hour
        base_times = [23, 20, 17, 14, 11, 8, 5, 2]
        selected = 2
        for bt in base_times:
            if hour >= bt:
                selected = bt
                break
        base_time = f"{selected:02d}00"
    else:
        base_date = target_date - timedelta(days=1)
        base_time = "0500"

    base_date_str = base_date.strftime("%Y%m%d")
    target_date_str = target_date.strftime("%Y%m%d")

    url = (
        f"https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst"
        f"?pageNo=1&numOfRows=1000&dataType=JSON"
        f"&base_date={base_date_str}&base_time={base_time}"
        f"&nx={KMA_NX}&ny={KMA_NY}"
        f"&authKey={KMA_AUTH_KEY}"
    )

    try:
        res = requests.get(url, timeout=30)
        res.raise_for_status()
        data = res.json()

        items = data.get("response", {}).get("body", {}).get("items", {}).get("item", [])
        if not items:
            print(f"  ⚠️ KMA 예보 데이터 없음: {target_date_str} (base: {base_date_str} {base_time})")
            return None

        # target_date의 TMP 카테고리만 필터
        temps = []
        for item in items:
            if item.get("category") == "TMP" and item.get("fcstDate") == target_date_str:
                temps.append(float(item["fcstValue"]))

        if not temps:
            print(f"  ⚠️ KMA TMP 데이터 없음: {target_date_str}")
            return None

        forecast_high = max(temps)
        print(f"  📊 KMA 예보 최고: {forecast_high}° ({len(temps)}시간 데이터)")
        return forecast_high

    except Exception as e:
        print(f"  ❌ KMA API 실패: {e}")
        return None


def fetch_wu_actual_high(target_date: datetime) -> "float | None":
    """
    Weather Underground API에서 target_date의 실측 최고기온 추출.
    """
    date_str = target_date.strftime("%Y%m%d")

    url = (
        f"https://api.weather.com/v1/location/{WU_STATION}/observations/historical.json"
        f"?apiKey={WU_API_KEY}&startDate={date_str}&endDate={date_str}&units=m"
    )

    try:
        res = requests.get(url, timeout=30)
        res.raise_for_status()
        data = res.json()

        observations = data.get("observations", [])
        if not observations:
            print(f"  ⚠️ WU 관측 데이터 없음: {date_str}")
            return None

        temps = [obs["temp"] for obs in observations if obs.get("temp") is not None]
        if not temps:
            return None

        actual_high = max(temps)
        print(f"  🌡️ WU 실측 최고: {actual_high}° ({len(temps)}개 관측)")
        return actual_high

    except Exception as e:
        print(f"  ❌ WU API 실패: {e}")
        return None


def capture_forecast():
    """당일 + 내일 KMA 예보 최고기온을 Supabase에 저장 (예보만, 실측은 아직 없음)"""
    sb = get_supabase()
    now_kst = datetime.now(KST)
    today = now_kst.date()

    print(f"═══ 예보 캡처 시작 ═══")
    print(f"  기준일: {today} KST\n")

    # 오늘 + 내일 + 모레 (KMA가 제공하는 범위)
    for offset in range(0, 3):
        target = today + timedelta(days=offset)
        target_dt = datetime(target.year, target.month, target.day)
        print(f"── {target} ──")

        # 이미 예보가 저장되어 있으면 건너뜀
        existing = sb.table("weather_forecast_accuracy") \
            .select("id, forecast_high") \
            .eq("city", "Seoul") \
            .eq("market_date", target.isoformat()) \
            .execute()

        if existing.data and existing.data[0].get("forecast_high") is not None:
            print(f"  ⏭️ 예보 이미 저장됨: {existing.data[0]['forecast_high']}°")
            continue

        # 당일 base_date로 KMA 예보 조회
        forecast_high = fetch_kma_forecast_high(target_dt, use_today_base=True)
        if forecast_high is None:
            print(f"  ⚠️ 예보 데이터 없음, 건너뜀")
            continue

        row = {
            "city": "Seoul",
            "market_date": target.isoformat(),
            "forecast_high": forecast_high,
            "unit": "C",
            "forecast_source": "KMA",
        }

        sb.table("weather_forecast_accuracy").upsert(row, on_conflict="city,market_date").execute()
        print(f"  ✅ 예보 저장: {forecast_high}°")

    print(f"\n═══ 예보 캡처 완료 ═══")


def resolve_actuals():
    """예보만 저장된 과거 날짜에 WU 실측을 채우고 오차 계산"""
    sb = get_supabase()
    now_kst = datetime.now(KST)
    today = now_kst.date()

    print(f"═══ 실측 결과 반영 시작 ═══\n")

    # actual_high가 NULL인 행 조회 (예보만 저장된 상태)
    pending = sb.table("weather_forecast_accuracy") \
        .select("*") \
        .eq("city", "Seoul") \
        .is_("actual_high", "null") \
        .lt("market_date", today.isoformat()) \
        .execute()

    if not pending.data:
        print("  모든 기록에 실측 반영 완료")
        return

    for row in pending.data:
        date_str = row["market_date"]
        print(f"── {date_str} ──")

        target_dt = datetime.strptime(date_str, "%Y-%m-%d")
        actual_high = fetch_wu_actual_high(target_dt)

        if actual_high is None:
            print(f"  ⚠️ 실측 데이터 없음, 건너뜀")
            continue

        forecast_high = row["forecast_high"]
        error = round(float(forecast_high) - actual_high, 1)
        abs_error = abs(error)

        sb.table("weather_forecast_accuracy") \
            .update({
                "actual_high": actual_high,
                "error": error,
                "abs_error": abs_error,
                "actual_source": "WU_RKSI",
            }) \
            .eq("id", row["id"]) \
            .execute()

        print(f"  ✅ 실측 반영: 예보 {forecast_high}° vs 실측 {actual_high}° → 오차 {error:+.1f}°")

    print(f"\n═══ 실측 결과 반영 완료 ═══")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"

    if mode == "capture":
        capture_forecast()
    elif mode == "resolve":
        resolve_actuals()
    else:
        capture_forecast()
        print()
        resolve_actuals()
