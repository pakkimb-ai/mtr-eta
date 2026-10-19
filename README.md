# 附近港鐵站 · 到站時間

用瀏覽器定位，自動判斷你附近嘅港鐵站，即時顯示下一班車 **還有幾多分鐘**（主顯示用 API 欄位 `ttnt`）。

> 註：對話早期提到「北紅站」，已理解為一般附近站工具需求，唔再鎖定北角。

## 功能

- **自動定位**：用 GPS 計同各站距離，揀最近車站（約 400 米內標成「附近」；1.2 公里內自動採用；再遠會提示核對）
- **手動揀站**：定位失敗／唔準時，下拉選單可改任何有 Next Train 資料嘅車站
- **多線到站**：該站所有涵蓋路線（港島／荃灣／觀塘／將軍澳／東鐵／屯馬／東涌／機場快線／南港島／迪士尼）一齊顯示
- **分鐘為主**：大字顯示「3 分鐘」「即將到站」；鐘面時間同月台做輔助
- **自動刷新**：約每 18 秒

## 點樣開

### 方法一：本機靜態伺服器（建議）

定位（Geolocation）喺多數瀏覽器要求 **HTTPS** 或 **localhost**。用 `file://` 直接開檔可能被拒定位。

```bash
cd /workspace/mtr-eta
python3 -m http.server 8765
```

然後用手機／電腦瀏覽器打開：

`http://localhost:8765/`  
（或同一區網 IP，例如 `http://192.168.x.x:8765/`——非 localhost 時部分瀏覽器仍要 HTTPS 先准定位；唔得就用手動揀站。）

### 方法二：任何靜態託管

把成個資料夾丟上 GitHub Pages、Netlify、Cloudflare Pages 等即可（本專案唔會幫你公開部署）。

## API

直接呼叫（瀏覽器可直連，已確認 `Access-Control-Allow-Origin: *`，**唔使 proxy**）：

```
GET https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line={LINE}&sta={STA}&lang=TC
```

例：`line=ISL&sta=NOP`

## 檔案

```
mtr-eta/
  index.html
  css/styles.css
  js/stations.js   # 車站中文名、座標、所屬路線
  js/app.js
  README.md
```

## 限制

- **CORS**：官方 API 允許 `*`，前端可直連
- **收車／未開出**：`UP`／`DOWN` 可能空白
- **定位精度**：室內、地庫、閘內 GPS 可能偏差大；頁面容許約 1.2 km 內自動認站，並提供手動改選
- **速率**：請唔好把刷新改得過密（官方約 10 秒更新一次）
- **馬場站等**：只喺特定日子有班次

## 授權資料

列車到站數據 © 香港鐵路有限公司，經 DATA.GOV.HK 開放。
