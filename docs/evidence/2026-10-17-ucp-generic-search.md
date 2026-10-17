# UCP generic search evidence

Date: 2026-10-17
UCP CLI: `0.9.1 (UCP 2026-04-08, 2026-08-25)`

The following live search-only probes used each exact query as its intent. No English fallback was needed because every Chinese query returned at least two distinct sellers.

The scarf probe met that seller-count threshold, but its two selected examples are a book titled “Umma” and a cookbook, not scarves. The returned JSON is preserved as-is; this is a relevance limitation despite the seller count.

## 防水外套 150 以内

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "防水外套 150 以内" --intent "防水外套 150 以内" --budget 150 --search-only
```

Result:

```json
{
  "query": "防水外套 150 以内",
  "intent": "防水外套 150 以内",
  "budget": 150,
  "size": null,
  "color": null,
  "totalOffers": 49,
  "distinctSellers": 32,
  "picked": [
    {
      "seller": "hairbrella.myshopify.com",
      "title": "Satin-Lined, Waterproof Rain Jacket",
      "variantTitle": "Satin-Lined, Waterproof Rain Jacket",
      "price": 125,
      "sizeOptions": [
        "Classic"
      ],
      "colorOptions": [
        "Black"
      ],
      "nativeCheckout": false
    },
    {
      "seller": "dri-duck-production.myshopify.com",
      "title": "Torrent Men's Hooded Jacket",
      "variantTitle": "Torrent Men's Hooded Jacket",
      "price": 99.99,
      "sizeOptions": [
        "Extra small (XS)"
      ],
      "colorOptions": [
        "Black"
      ],
      "nativeCheckout": false
    }
  ]
}
```

## 送妈妈的围巾

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "送妈妈的围巾" --intent "送妈妈的围巾" --search-only
```

Result:

```json
{
  "query": "送妈妈的围巾",
  "intent": "送妈妈的围巾",
  "budget": 200,
  "size": null,
  "color": null,
  "totalOffers": 42,
  "distinctSellers": 34,
  "picked": [
    {
      "seller": "book-larder.myshopify.com",
      "title": "Umma",
      "variantTitle": "Umma",
      "price": 35,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    },
    {
      "seller": "e9c22f-3.myshopify.com",
      "title": "Best Chinese Take-out Recipes from Mama Li's Kitchen ***Large Print Color Edition***",
      "variantTitle": "Best Chinese Take-out Recipes from Mama Li's Kitchen ***Large Print Color Edition***",
      "price": 27.27,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    }
  ]
}
```

## 10 码篮球鞋

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "10 码篮球鞋" --intent "10 码篮球鞋" --size 10 --search-only
```

Result:

```json
{
  "query": "10 码篮球鞋",
  "intent": "10 码篮球鞋",
  "budget": 200,
  "size": "10",
  "color": null,
  "totalOffers": 46,
  "distinctSellers": 21,
  "picked": [
    {
      "seller": "millennium-shoes.myshopify.com",
      "title": "Kobe 10 Protro 'Halo' Basketball Shoes",
      "variantTitle": "Kobe 10 Protro 'Halo' Basketball Shoes",
      "price": 161.49,
      "sizeOptions": [
        "10"
      ],
      "colorOptions": [],
      "nativeCheckout": false
    },
    {
      "seller": "league-outfitters.myshopify.com",
      "title": "adidas Men's Harden Volume 10 Basketball Shoes",
      "variantTitle": "adidas Men's Harden Volume 10 Basketball Shoes",
      "price": 159.95,
      "sizeOptions": [
        "10"
      ],
      "colorOptions": [
        "Ice Gold Metallic/Core Black/Lime Burst"
      ],
      "nativeCheckout": false
    }
  ]
}
```
