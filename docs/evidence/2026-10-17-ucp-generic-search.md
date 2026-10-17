# UCP generic search evidence

Date: 2026-10-17
UCP CLI: `0.9.1 (UCP 2026-04-08, 2026-08-25)`

These are fresh live `--search-only` results. Each query was also used verbatim as intent. The title-keyword count is a deterministic case-insensitive match against every returned product title, using the pattern shown; it is not a relevance judgment. The added `--title-keyword` option only computes this summary count and does not change the search input.

## 防水外套 150 以内

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "防水外套 150 以内" --intent "防水外套 150 以内" --budget 150 --search-only --title-keyword "jacket|外套|coat|shell"
```

Title-keyword count: **47 / 50** product titles match `/jacket|外套|coat|shell/i`.

Both picked offers are jackets: “Satin-Lined, Waterproof Rain Jacket” and “Torrent Men's Hooded Jacket.”

```json
{
  "query": "防水外套 150 以内",
  "intent": "防水外套 150 以内",
  "budget": 150,
  "size": null,
  "color": null,
  "totalOffers": 50,
  "distinctSellers": 33,
  "titleKeywordCount": {
    "pattern": "jacket|外套|coat|shell",
    "count": 47
  },
  "picked": [
    {
      "seller": "hairbrella.myshopify.com",
      "title": "Satin-Lined, Waterproof Rain Jacket",
      "variantTitle": "Satin-Lined, Waterproof Rain Jacket",
      "priceUsd": 125,
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
      "priceUsd": 99.99,
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
pnpm --filter @agent-cookie/ucp record -- --query "送妈妈的围巾" --intent "送妈妈的围巾" --search-only --title-keyword "scarf|围巾|shawl|wrap"
```

Title-keyword count: **0 / 42** product titles match `/scarf|围巾|shawl|wrap/i`.

The picked offers are not scarves: “Umma” is a book, and the other is a cookbook titled “Best Chinese Take-out Recipes from Mama Li's Kitchen ***Large Print Color Edition***.” This query is not a category pass.

```json
{
  "query": "送妈妈的围巾",
  "intent": "送妈妈的围巾",
  "budget": null,
  "size": null,
  "color": null,
  "totalOffers": 42,
  "distinctSellers": 34,
  "titleKeywordCount": {
    "pattern": "scarf|围巾|shawl|wrap",
    "count": 0
  },
  "picked": [
    {
      "seller": "book-larder.myshopify.com",
      "title": "Umma",
      "variantTitle": "Umma",
      "priceUsd": 35,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    },
    {
      "seller": "e9c22f-3.myshopify.com",
      "title": "Best Chinese Take-out Recipes from Mama Li's Kitchen ***Large Print Color Edition***",
      "variantTitle": "Best Chinese Take-out Recipes from Mama Li's Kitchen ***Large Print Color Edition***",
      "priceUsd": 27.27,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    }
  ]
}
```

## scarf for mom (scarf fallback)

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "scarf for mom" --intent "scarf for mom" --search-only --title-keyword "scarf|围巾|shawl|wrap"
```

Title-keyword count: **46 / 49** product titles match `/scarf|围巾|shawl|wrap/i`.

Both picked offers are scarves: “Carson Mom Print Scarf 21x21” and “The Scarf It Up - Cosmos.”

```json
{
  "query": "scarf for mom",
  "intent": "scarf for mom",
  "budget": null,
  "size": null,
  "color": null,
  "totalOffers": 49,
  "distinctSellers": 36,
  "titleKeywordCount": {
    "pattern": "scarf|围巾|shawl|wrap",
    "count": 46
  },
  "picked": [
    {
      "seller": "ink-alloy-2.myshopify.com",
      "title": "Carson Mom Print Scarf 21x21",
      "variantTitle": "Carson Mom Print Scarf 21x21",
      "priceUsd": 30,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    },
    {
      "seller": "motherdenim.myshopify.com",
      "title": "The Scarf It Up - Cosmos",
      "variantTitle": "The Scarf It Up - Cosmos",
      "priceUsd": 225,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    }
  ]
}
```

## 围巾 (scarf fallback)

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "围巾" --intent "围巾" --search-only --title-keyword "scarf|围巾|shawl|wrap"
```

Title-keyword count: **1 / 49** product titles match `/scarf|围巾|shawl|wrap/i`.

The two picks do not establish two scarf offers: “Silverthread Bath Towel” is a bath towel, and “はっけよい小紋” does not identify a scarf in its title.

```json
{
  "query": "围巾",
  "intent": "围巾",
  "budget": null,
  "size": null,
  "color": null,
  "totalOffers": 49,
  "distinctSellers": 23,
  "titleKeywordCount": {
    "pattern": "scarf|围巾|shawl|wrap",
    "count": 1
  },
  "picked": [
    {
      "seller": "yoso-tokyo.myshopify.com",
      "title": "はっけよい小紋",
      "variantTitle": "はっけよい小紋",
      "priceUsd": 11,
      "sizeOptions": [],
      "colorOptions": [],
      "nativeCheckout": false
    },
    {
      "seller": "sleepdreamdeep.myshopify.com",
      "title": "Silverthread Bath Towel",
      "variantTitle": "Silverthread Bath Towel",
      "priceUsd": 32.99,
      "sizeOptions": [],
      "colorOptions": [
        "Grey"
      ],
      "nativeCheckout": false
    }
  ]
}
```

## 10 码篮球鞋

Command:

```sh
pnpm --filter @agent-cookie/ucp record -- --query "10 码篮球鞋" --intent "10 码篮球鞋" --size 10 --search-only --title-keyword "basketball|篮球"
```

Title-keyword count: **6 / 46** product titles match `/basketball|篮球/i`.

Both picked offers are basketball shoes: “Kobe 10 Protro 'Halo' Basketball Shoes” and “adidas Men's Harden Volume 10 Basketball Shoes.”

```json
{
  "query": "10 码篮球鞋",
  "intent": "10 码篮球鞋",
  "budget": null,
  "size": "10",
  "color": null,
  "totalOffers": 46,
  "distinctSellers": 27,
  "titleKeywordCount": {
    "pattern": "basketball|篮球",
    "count": 6
  },
  "picked": [
    {
      "seller": "millennium-shoes.myshopify.com",
      "title": "Kobe 10 Protro 'Halo' Basketball Shoes",
      "variantTitle": "Kobe 10 Protro 'Halo' Basketball Shoes",
      "priceUsd": 161.49,
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
      "priceUsd": 159.95,
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
