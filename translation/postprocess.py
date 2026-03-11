"""
번역 후처리 통합 모듈

모든 번역 스크립트에서 공통으로 사용하는 후처리 파이프라인.
번역 결과의 품질을 보장하기 위한 5단계 처리:
  [1] 용어 교정 (인물명, 금융용어 등)
  [2] 시간대 검증 (ET/PT 누락 시 자동 추가)
  [3] "가질까" 문맥 교정
  [4] 문화 맥락 사전
  [5] 영어 월명 → 한글 변환

사용법:
    from postprocess import postprocess_translation
    result = postprocess_translation(original_title, translated_title)
"""

import re


# ============================================================
# [1] 용어 교정 사전
# LLM이 용어집을 무시했을 때 강제 교정
# ============================================================

GLOSSARY_CORRECTIONS = {
    # 인물명
    '엘론 머스크': '일론 머스크',
    '엘론이': '일론이',
    '엘론의': '일론의',
    '엘론은': '일론은',
    '반스': '밴스',
    '젤렌스끼': '젤렌스키',
    '습근평': '시진핑',
    '주커버그': '저커버그',
    '알트만': '올트먼',
    '네탄야후': '네타냐후',
    '매크롱': '마크롱',
    # 정치/사회
    '행정 명령': '행정명령',
    '경기 침체': '경기침체',
    '아카데미상': '오스카상',
    '아카데미 시상식': '오스카 시상식',
    '슈퍼 볼': '슈퍼볼',
    # 금융
    '연방준비': '연준',
    '이자율': '금리',
    '에어드롭': '에어드랍',
}


# ============================================================
# [3] "가질까" 문맥 교정 규칙
# "have"를 문맥에 따라 적절한 동사로 교정
# ============================================================

HAVE_CORRECTIONS = [
    # 순위/모델 관련: "가질까" → "차지할까"
    (r'(최고의|최고|1위|2위|3위|#\d+위|#\d+)\s*.+을 가질까', '을 차지할까'),
    (r'(최고의|최고|1위|2위|3위|#\d+위|#\d+)\s*.+를 가질까', '를 차지할까'),
    (r'세 번째로 좋은.+을 가질까', '을 차지할까'),
    (r'세 번째로 좋은.+를 가질까', '를 차지할까'),
    (r'두 번째로 좋은.+을 가질까', '을 차지할까'),
    (r'두 번째로 좋은.+를 가질까', '를 차지할까'),

    # 공연/선보이기: "가질까" → "선보일까"
    (r'(댄서|공연|로봇|퍼포먼스).+를 가질까', '를 선보일까'),
    (r'(댄서|공연|로봇|퍼포먼스).+을 가질까', '을 선보일까'),

    # 기록/수치: "가질까" → "기록할까"
    (r'(청취자|조회수|팔로워|시청자|구독자).+를 가질까', '를 기록할까'),
    (r'(청취자|조회수|팔로워|시청자|구독자).+을 가질까', '을 기록할까'),
]


# ============================================================
# [4] 문화 맥락 사전
# 직역하면 의미가 전달되지 않는 문화적 표현
# ============================================================

CULTURAL_CONTEXT = {
    # 중국 문화
    '봄 축제 갈라': 'CCTV 춘완(춘절 갈라쇼)',
    '춘제 갈라': 'CCTV 춘완(춘절 갈라쇼)',
    '스프링 페스티벌 갈라': 'CCTV 춘완(춘절 갈라쇼)',
    '봄축제 갈라': 'CCTV 춘완(춘절 갈라쇼)',

    # 격투기 용어
    '거리를 두고 갈까': '풀라운드까지 갈까',
    '거리가 끝날까': '풀라운드까지 갈까',
    '거리를 두고 진행될까': '풀라운드까지 갈까',
    '거리로 갈까': '풀라운드까지 갈까',
    '싸움이 KO': '경기가 KO',
    '싸움이 TKO': '경기가 TKO',

    # e스포츠 용어 (통일)
    '첫 번째 킬': '퍼스트 블러드',
    '첫 번째 피가 나올까': '퍼스트 블러드가 나올까',
    '첫 번째 피를 흘릴까': '퍼스트 블러드가 나올까',
    '첫 피를 흘릴까': '퍼스트 블러드가 나올까',
    '첫 피가 날까': '퍼스트 블러드가 나올까',
    '첫 킬': '퍼스트 블러드',
}


# ============================================================
# [5] 영어 월명 → 한글 변환
# ============================================================

MONTH_MAP = {
    'January': '1월', 'February': '2월', 'March': '3월',
    'April': '4월', 'May': '5월', 'June': '6월',
    'July': '7월', 'August': '8월', 'September': '9월',
    'October': '10월', 'November': '11월', 'December': '12월',
}


# ============================================================
# 개별 처리 함수들
# ============================================================

def apply_glossary_corrections(text: str) -> str:
    """[1] 용어 교정"""
    for wrong, correct in GLOSSARY_CORRECTIONS.items():
        if wrong in text:
            text = text.replace(wrong, correct)
    return text


def fix_timezone_consistency(original: str, translated: str) -> str:
    """[2] 시간대(ET, PT 등) 누락 시 자동 추가"""
    timezone_pattern = r'\b([0-9]{1,2}(?::[0-9]{2})?(?:AM|PM)?)\s+(ET|PT|EST|PST|UTC|GMT)\b'
    original_match = re.search(timezone_pattern, original, re.IGNORECASE)

    if not original_match:
        return translated

    timezone = original_match.group(2).upper()

    if timezone in translated:
        return translated

    # 시간대가 누락된 경우 자동 추가
    time_patterns = [
        (r'(오전|오후)\s*(\d{1,2})시에', rf'\1 \2시 {timezone}에'),
        (r'(오전|오후)\s*(\d{1,2})시\s*(\d{1,2})분에', rf'\1 \2시 \3분 {timezone}에'),
        (r'자정에', f'자정 {timezone}에'),
        (r'정오에', f'정오 {timezone}에'),
    ]

    for pattern, replacement in time_patterns:
        if re.search(pattern, translated):
            return re.sub(pattern, replacement, translated)

    return translated


def fix_have_translations(text: str) -> str:
    """[3] 'have' 직역 '가질까' 문맥 교정"""
    if '가질까' not in text:
        return text

    for pattern, suffix in HAVE_CORRECTIONS:
        if re.search(pattern, text):
            text = re.sub(r'[을를] 가질까', suffix, text)
            break

    return text


def apply_cultural_context(text: str) -> str:
    """[4] 문화 맥락 사전 적용"""
    for wrong, correct in CULTURAL_CONTEXT.items():
        if wrong in text:
            text = text.replace(wrong, correct)
    return text


def fix_english_months(text: str) -> str:
    """[5] 영어 월명 → 한글 변환"""
    for eng, kor in MONTH_MAP.items():
        if eng in text:
            text = text.replace(eng, kor)
    return text


# ============================================================
# 통합 파이프라인
# ============================================================

def postprocess_translation(original: str, translated: str) -> str:
    """
    번역 후처리 파이프라인 (순서 중요)

    Args:
        original: 영어 원문 제목
        translated: LLM 번역 결과

    Returns:
        후처리된 최종 번역
    """
    result = apply_glossary_corrections(translated)       # [1]
    result = fix_timezone_consistency(original, result)    # [2]
    result = fix_have_translations(result)                 # [3]
    result = apply_cultural_context(result)                # [4]
    result = fix_english_months(result)                    # [5]
    return result
