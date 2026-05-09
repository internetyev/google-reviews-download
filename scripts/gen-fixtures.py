#!/usr/bin/env python3
"""Generate mock SemanticForce fixtures for the reviews-download tool.

Produces mocks/semanticforce/{mid,large}-business.json deterministically so
reruns yield byte-identical output (seeded `random`). The schema mirrors
docs/semanticforce-api.md — see lib/semanticforce/types.ts when L1.4 lands.

Usage: python3 scripts/gen-fixtures.py
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "mocks" / "semanticforce"

LANG_WEIGHTS = {
    "en": 40, "es": 15, "de": 10, "fr": 8, "it": 5, "pt": 5,
    "pl": 3, "nl": 3, "ja": 3, "ko": 2, "zh": 2, "ar": 2, "ru": 2,
}

RATING_WEIGHTS = {5: 60, 4: 20, 3: 10, 2: 5, 1: 5}

NAMES = {
    "en": ["Maria S.", "Tom L.", "Aisha R.", "Daniel K.", "Jenny P.",
           "Robert F.", "Sarah W.", "Kevin H.", "Emma D.", "Mark T.",
           "Olivia N.", "Liam B.", "Ava R.", "Noah F.", "Mia J."],
    "es": ["Carlos P.", "Lucía M.", "Javier R.", "Sofía G.", "Diego A.",
           "Isabel C.", "Manuel L.", "Elena V.", "Pablo H."],
    "de": ["Lukas M.", "Anna B.", "Jonas K.", "Lena S.", "Felix W.",
           "Marie H.", "Tobias R."],
    "fr": ["Camille D.", "Léa P.", "Hugo M.", "Manon T.", "Antoine R.",
           "Élodie B."],
    "it": ["Marco R.", "Giulia C.", "Luca B.", "Chiara V.", "Alessandro N."],
    "pt": ["João S.", "Ana C.", "Pedro M.", "Beatriz F.", "Tiago L."],
    "pl": ["Anna O.", "Piotr K.", "Magda W.", "Tomasz Z."],
    "nl": ["Sanne J.", "Bram V.", "Lotte M.", "Daan K."],
    "ja": ["Yuki H.", "Takeshi N.", "Saori O.", "Kenji M."],
    "ko": ["Min-jun K.", "Ji-woo P.", "Soo-yeon L."],
    "zh": ["Wei L.", "Mei Z.", "Hao C."],
    "ar": ["Ahmed K.", "Layla H.", "Omar S."],
    "ru": ["Дмитрий П.", "Ольга К.", "Иван С."],
}

PHRASES = {
    "en": {
        "pos": [
            "Best coffee in town! Cosy spot with great wifi.",
            "Friendly baristas and amazing pastries 🥐",
            "My go-to morning stop. Highly recommend.",
            "Hidden gem — the cinnamon rolls are unreal.",
            "Perfect place to work for a few hours.",
        ],
        "neu": [
            "Decent coffee, nothing groundbreaking.",
            "It's fine — the seating is a bit cramped though.",
            "Solid spot but a bit pricey for the area.",
        ],
        "neg": [
            "Way overpriced for what you get. Won't return.",
            "Service was slow and staff seemed annoyed.",
            "Coffee was burnt. Disappointing.",
        ],
    },
    "es": {
        "pos": [
            "¡El mejor café del barrio! Ambiente acogedor.",
            "Trato excelente y café espectacular ☕",
            "Sitio ideal para trabajar unas horas.",
            "Repostería deliciosa, vuelvo seguro.",
        ],
        "neu": [
            "Está bien, pero nada del otro mundo.",
            "Café decente, precio un poco alto.",
        ],
        "neg": [
            "Demasiado caro y servicio lento.",
            "El café estaba quemado. No volveré.",
        ],
    },
    "de": {
        "pos": [
            "Top Kaffee, super freundliches Personal!",
            "Sehr empfehlenswerte Adresse 💛",
            "Mein Lieblingsort zum Arbeiten.",
            "Heimisches Café mit super Espresso.",
        ],
        "neu": [
            "Ganz okay, aber nicht herausragend.",
            "Solide, aber für den Preis nicht spektakulär.",
        ],
        "neg": [
            "Zu teuer für das, was geboten wird.",
            "Service war heute leider unfreundlich.",
        ],
    },
    "fr": {
        "pos": [
            "Le meilleur café du quartier !",
            "Ambiance super et baristas accueillants.",
            "Endroit parfait pour travailler ☕",
        ],
        "neu": [
            "Correct, sans plus.",
            "Café honnête mais un peu cher.",
        ],
        "neg": [
            "Service vraiment décevant.",
            "Trop cher pour la qualité.",
        ],
    },
    "it": {
        "pos": [
            "Caffè eccezionale, ambiente perfetto.",
            "Da consigliare assolutamente!",
            "Il mio bar preferito della zona.",
        ],
        "neu": [
            "Niente di speciale ma carino.",
            "Caffè discreto, prezzi medi.",
        ],
        "neg": [
            "Prezzi alti e servizio mediocre.",
        ],
    },
    "pt": {
        "pos": [
            "Melhor café da região!",
            "Atendimento ótimo e ambiente acolhedor.",
            "Adoro este lugar — recomendo muito.",
        ],
        "neu": [
            "Razoável, mas nada de especial.",
        ],
        "neg": [
            "Demorado e caro demais.",
            "Café fraco para o preço cobrado.",
        ],
    },
    "pl": {
        "pos": [
            "Najlepsza kawa w okolicy!",
            "Cudowna atmosfera, polecam.",
            "Tradycyjna kawa, mily personel.",
        ],
        "neu": [
            "W porządku, ale bez szału.",
        ],
        "neg": [
            "Za drogo jak na to, co dają.",
        ],
    },
    "nl": {
        "pos": [
            "Beste koffie in de buurt!",
            "Heerlijk plekje om te werken.",
        ],
        "neu": [
            "Prima, niets bijzonders.",
        ],
        "neg": [
            "Te duur voor wat je krijgt.",
        ],
    },
    "ja": {
        "pos": [
            "最高のコーヒー!落ち着く雰囲気。",
            "また絶対行きます ☕",
            "店員さんがとても親切でした。",
        ],
        "neu": [
            "まあまあ。可もなく不可もなく。",
        ],
        "neg": [
            "値段の割には微妙でした。",
        ],
    },
    "ko": {
        "pos": [
            "커피가 정말 맛있어요!",
            "분위기 좋고 직원분들이 친절해요.",
        ],
        "neu": [
            "괜찮아요. 평범한 카페.",
        ],
        "neg": [
            "가격이 너무 비싸요.",
        ],
    },
    "zh": {
        "pos": [
            "咖啡非常棒,环境也很舒适!",
            "推荐!服务一流。",
        ],
        "neu": [
            "还行,没有特别惊艳。",
        ],
        "neg": [
            "价格偏高,服务一般。",
        ],
    },
    "ar": {
        "pos": [
            "أفضل قهوة في المنطقة!",
            "مكان رائع للعمل والاسترخاء.",
        ],
        "neu": [
            "لا بأس به، عادي.",
        ],
        "neg": [
            "الأسعار مرتفعة جدا.",
        ],
    },
    "ru": {
        "pos": [
            "Лучший кофе в городе!",
            "Уютная атмосфера, очень рекомендую.",
        ],
        "neu": [
            "Нормально, но ничего особенного.",
        ],
        "neg": [
            "Очень дорого и медленное обслуживание.",
        ],
    },
}

OWNER_RESPONSES = {
    "en": {
        "pos": "Thank you so much! Hope to see you again soon.",
        "neu": "Thanks for the honest feedback — we'll keep improving.",
        "neg": "We're sorry to hear this. Please email us so we can make it right.",
    },
    "es": {
        "pos": "¡Muchas gracias por tu visita!",
        "neu": "Gracias por tu comentario, lo tenemos en cuenta.",
        "neg": "Lo sentimos mucho — escríbenos y lo solucionamos.",
    },
    "de": {
        "pos": "Vielen Dank — bis bald wieder!",
        "neu": "Danke für das Feedback — wir arbeiten daran.",
        "neg": "Das tut uns leid. Bitte kontaktieren Sie uns direkt.",
    },
    "fr": {
        "pos": "Merci beaucoup, à très vite !",
        "neu": "Merci pour votre retour, nous en tenons compte.",
        "neg": "Nous sommes désolés — merci de nous écrire en privé.",
    },
    "it": {
        "pos": "Grazie mille, a presto!",
        "neu": "Grazie per il feedback, ne terremo conto.",
        "neg": "Ci dispiace molto — scrivici per risolvere.",
    },
    "pt": {
        "pos": "Muito obrigado pela visita!",
        "neu": "Obrigado pelo feedback, vamos melhorar.",
        "neg": "Lamentamos muito — escreva-nos para resolver.",
    },
    "pl": {
        "pos": "Dziękujemy serdecznie, do zobaczenia!",
        "neu": "Dziękujemy za opinię, pracujemy nad tym.",
        "neg": "Bardzo przepraszamy — prosimy o kontakt mailowy.",
    },
    "nl": {
        "pos": "Heel erg bedankt, tot snel!",
        "neu": "Bedankt voor de feedback.",
        "neg": "Onze excuses — mail ons even, dan lossen we het op.",
    },
    "ja": {
        "pos": "ありがとうございます。またのご来店お待ちしております。",
        "neu": "ご意見ありがとうございます。改善に努めます。",
        "neg": "申し訳ございません。メールでご連絡いただけますと幸いです。",
    },
    "ko": {
        "pos": "감사합니다! 또 방문해주세요.",
        "neu": "피드백 감사합니다. 개선하겠습니다.",
        "neg": "죄송합니다. 이메일로 연락 주시면 해결해드리겠습니다.",
    },
    "zh": {
        "pos": "非常感谢您的支持!欢迎再来。",
        "neu": "感谢您的反馈,我们会继续改进。",
        "neg": "非常抱歉给您带来不便,请通过邮件联系我们。",
    },
    "ar": {
        "pos": "شكرا جزيلا، نتطلع لعودتك!",
        "neu": "شكرا على ملاحظتك، سنعمل على التحسين.",
        "neg": "نأسف لذلك. يرجى التواصل معنا عبر البريد.",
    },
    "ru": {
        "pos": "Большое спасибо! Будем рады видеть вас снова.",
        "neu": "Спасибо за отзыв, мы учтём.",
        "neg": "Нам очень жаль — напишите нам, мы всё решим.",
    },
}

OWNER_RESPONSE_CHANCE = {1: 0.70, 2: 0.50, 3: 0.20, 4: 0.05, 5: 0.03}


def weighted_pick(rng: random.Random, weights: dict):
    keys = list(weights.keys())
    ws = list(weights.values())
    return rng.choices(keys, weights=ws, k=1)[0]


def make_review(rng: random.Random, idx: int, end_dt: datetime, span_days: int) -> dict:
    lang = weighted_pick(rng, LANG_WEIGHTS)
    rating = weighted_pick(rng, RATING_WEIGHTS)
    sentiment = "pos" if rating >= 4 else ("neu" if rating == 3 else "neg")

    text = rng.choice(PHRASES[lang][sentiment])
    name = rng.choice(NAMES[lang])

    days_back = rng.randint(0, span_days)
    minutes_back = rng.randint(0, 1439)
    pub = end_dt - timedelta(days=days_back, minutes=minutes_back)

    review: dict = {
        "review_id": f"r{idx:04d}",
        "author_name": name,
        "rating": rating,
        "text": text,
        "language": lang,
        "published_at": pub.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    if rng.random() < 0.30:
        review["author_url"] = f"https://maps.google.com/contrib/mock_{idx:04d}"

    if rng.random() < 0.15:
        n_photos = rng.randint(1, 3)
        review["photos"] = [
            {
                "url": f"https://example.com/mock-photo-{idx:04d}-{p}.jpg",
                "width": rng.choice([800, 1024, 1280]),
                "height": rng.choice([600, 768, 960]),
            }
            for p in range(n_photos)
        ]

    if rng.random() < OWNER_RESPONSE_CHANCE[rating]:
        resp_dt = pub + timedelta(days=rng.randint(0, 5), hours=rng.randint(0, 23))
        review["owner_response"] = {
            "text": OWNER_RESPONSES[lang][sentiment],
            "responded_at": resp_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    return review


def generate(seed: int, n: int, place_id: str, name: str, address: str) -> dict:
    rng = random.Random(seed)
    end_dt = datetime(2026, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
    span_days = 365 * 2

    reviews = [make_review(rng, i + 1, end_dt, span_days) for i in range(n)]
    reviews.sort(key=lambda r: r["published_at"], reverse=True)
    for i, r in enumerate(reviews, 1):
        r["review_id"] = f"r{i:04d}"

    avg = round(sum(r["rating"] for r in reviews) / n, 2)
    rating_count = n + rng.randint(n // 10, n // 4)

    return {
        "place": {
            "place_id": place_id,
            "name": name,
            "address": address,
            "rating_avg": avg,
            "rating_count": rating_count,
            "url": f"https://maps.google.com/?cid=mock_{place_id.lower()}",
        },
        "reviews": reviews,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    mid = generate(
        seed=2026_05_10_080,
        n=80,
        place_id="MOCK_MID_001",
        name="Bistro La Plaza",
        address="42 Rue des Lilas, 75011 Paris, France",
    )
    (OUT_DIR / "mid-business.json").write_text(
        json.dumps(mid, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    large = generate(
        seed=2026_05_10_500,
        n=500,
        place_id="MOCK_LARGE_001",
        name="The Riverside Hotel",
        address="200 River Road, London SE1 9PX, United Kingdom",
    )
    (OUT_DIR / "large-business.json").write_text(
        json.dumps(large, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"wrote {OUT_DIR/'mid-business.json'} ({len(mid['reviews'])} reviews)")
    print(f"wrote {OUT_DIR/'large-business.json'} ({len(large['reviews'])} reviews)")


if __name__ == "__main__":
    main()
