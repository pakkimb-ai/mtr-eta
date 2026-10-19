(function () {
  "use strict";

  const API =
    "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php";
  const REFRESH_MS = 18000;
  const NEAR_M = 400; // 「就喺附近」
  const PICK_MAX_M = 1200; // 自動揀最近站上限；超過仍會顯示最近但標示較遠

  const { LINES, DEST_NAMES, STATIONS } = window.MTR_DATA;

  const el = {
    stationTitle: document.getElementById("stationTitle"),
    stationMeta: document.getElementById("stationMeta"),
    geoStatus: document.getElementById("geoStatus"),
    etaRoot: document.getElementById("etaRoot"),
    lastUpdated: document.getElementById("lastUpdated"),
    delayBanner: document.getElementById("delayBanner"),
    stationSelect: document.getElementById("stationSelect"),
    btnLocate: document.getElementById("btnLocate"),
    btnRefresh: document.getElementById("btnRefresh"),
  };

  let currentCode = null;
  let source = "auto"; // auto | manual
  let timer = null;
  let abortCtrl = null;

  function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function findNearest(lat, lng) {
    let best = null;
    let bestD = Infinity;
    for (const s of STATIONS) {
      const d = haversineM(lat, lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return { station: best, distanceM: bestD };
  }

  function stationByCode(code) {
    return STATIONS.find((s) => s.code === code) || null;
  }

  function destName(code) {
    return DEST_NAMES[code] || code;
  }

  function formatDistance(m) {
    if (m < 1000) return Math.round(m) + " 米";
    return (m / 1000).toFixed(1) + " 公里";
  }

  function formatClock(isoLike) {
    // "2026-10-18 21:18:05" -> 21:18
    if (!isoLike || isoLike.length < 16) return "";
    return isoLike.slice(11, 16);
  }

  function ttntLabel(ttnt) {
    const n = Number(ttnt);
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n === 0) return "即將到站";
    return n + " 分鐘";
  }

  function fillStationSelect() {
    const sorted = STATIONS.slice().sort((a, b) =>
      a.nameZh.localeCompare(b.nameZh, "zh-Hant")
    );
    el.stationSelect.innerHTML =
      '<option value="">— 手動選擇車站 —</option>' +
      sorted
        .map(
          (s) =>
            `<option value="${s.code}">${s.nameZh}（${s.lines
              .map((l) => LINES[l]?.nameZh || l)
              .join("／")}）</option>`
        )
        .join("");
  }

  function setGeoStatus(html, kind) {
    el.geoStatus.className = "geo-status" + (kind ? " " + kind : "");
    el.geoStatus.innerHTML = html;
  }

  function updateHeader(station, opts) {
    const { distanceM, note } = opts || {};
    el.stationTitle.textContent = station.nameZh + "站";
    const lineChips = station.lines
      .map((l) => {
        const meta = LINES[l] || { nameZh: l, color: "#666" };
        return `<span class="chip" style="--c:${meta.color}">${meta.nameZh}</span>`;
      })
      .join("");
    let meta = lineChips;
    if (typeof distanceM === "number") {
      meta += `<span class="dist">距離約 ${formatDistance(distanceM)}</span>`;
    }
    if (note) meta += `<span class="note">${note}</span>`;
    el.stationMeta.innerHTML = meta;
    el.stationSelect.value = station.code;
  }

  async function fetchLineSchedule(line, sta) {
    const url = `${API}?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(
      sta
    )}&lang=TC`;
    const res = await fetch(url, { signal: abortCtrl?.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  function renderTrains(trains) {
    if (!trains || !trains.length) {
      return '<p class="empty">暫時未有班次資料（可能收車或未開出）。</p>';
    }
    return (
      '<ul class="train-list">' +
      trains
        .filter((t) => t.valid !== "N")
        .map((t) => {
          const mins = ttntLabel(t.ttnt);
          const isImminent = Number(t.ttnt) === 0;
          return `<li class="train-card${isImminent ? " imminent" : ""}">
            <div class="mins">${mins}</div>
            <div class="train-meta">
              <div class="dest">開往 <strong>${destName(t.dest)}</strong></div>
              <div class="sub">月台 ${t.plat || "—"} · ${formatClock(
            t.time
          )}</div>
            </div>
          </li>`;
        })
        .join("") +
      "</ul>"
    );
  }

  function renderSchedule(station, results) {
    const parts = [];
    let anyDelay = false;
    let anyOk = false;

    for (const { line, data, error } of results) {
      const meta = LINES[line] || { nameZh: line, color: "#666" };
      if (error) {
        parts.push(`<section class="line-block" style="--c:${meta.color}">
          <h2><span class="dot"></span>${meta.nameZh}<span class="err-tag">讀取失敗</span></h2>
          <p class="empty">${error}</p>
        </section>`);
        continue;
      }
      if (String(data.isdelay).toUpperCase() === "Y") anyDelay = true;
      if (data.status === 0) {
        parts.push(`<section class="line-block" style="--c:${meta.color}">
          <h2><span class="dot"></span>${meta.nameZh}</h2>
          <p class="empty">${data.message || "暫時未能提供班次"}</p>
        </section>`);
        continue;
      }
      anyOk = true;
      const key = `${line}-${station.code}`;
      const block = (data.data && data.data[key]) || {};
      const up = block.UP || [];
      const down = block.DOWN || [];

      // Group by destination for clearer "開往"
      // Still show UP/DOWN as 方向 if both exist
      function dirLabel(trains, fallback) {
        const first = (trains || []).find((t) => t.valid !== "N");
        if (first) return "往 " + destName(first.dest);
        return fallback;
      }
      let body = "";
      if (up.length) {
        body += `<h3 class="dir">${dirLabel(up, "上行")}</h3>${renderTrains(up)}`;
      }
      if (down.length) {
        body += `<h3 class="dir">${dirLabel(down, "下行")}</h3>${renderTrains(down)}`;
      }
      if (!up.length && !down.length) {
        body = '<p class="empty">暫時未有班次資料（可能收車）。</p>';
      }

      parts.push(`<section class="line-block" style="--c:${meta.color}">
        <h2><span class="dot"></span>${meta.nameZh}</h2>
        ${body}
      </section>`);
    }

    el.etaRoot.innerHTML = parts.join("") || '<p class="empty">未有資料</p>';
    el.delayBanner.hidden = !anyDelay;
    const now = new Date();
    const hk = now.toLocaleString("zh-HK", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    el.lastUpdated.textContent = anyOk
      ? `上次更新：${hk}（香港時間）· 約每 ${REFRESH_MS / 1000} 秒自動刷新`
      : `更新時間：${hk}（香港時間）`;
  }

  async function loadEta(station) {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    el.etaRoot.classList.add("loading");
    el.etaRoot.setAttribute("aria-busy", "true");

    const results = await Promise.all(
      station.lines.map(async (line) => {
        try {
          const data = await fetchLineSchedule(line, station.code);
          return { line, data };
        } catch (e) {
          if (e.name === "AbortError") throw e;
          return { line, error: e.message || "網絡錯誤" };
        }
      })
    );

    el.etaRoot.classList.remove("loading");
    el.etaRoot.setAttribute("aria-busy", "false");
    renderSchedule(station, results);
  }

  function selectStation(station, opts) {
    currentCode = station.code;
    updateHeader(station, opts);
    loadEta(station).catch((e) => {
      if (e.name === "AbortError") return;
      el.etaRoot.innerHTML = `<p class="empty">無法載入到站時間：${e.message}</p>`;
    });
    restartTimer();
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      const s = stationByCode(currentCode);
      if (s) loadEta(s).catch(() => {});
    }, REFRESH_MS);
  }

  function locate() {
    if (!navigator.geolocation) {
      setGeoStatus("呢個瀏覽器唔支援定位。請手動揀車站。", "warn");
      return;
    }
    setGeoStatus("定位中…", "info");
    el.btnLocate.disabled = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.btnLocate.disabled = false;
        const { latitude, longitude, accuracy } = pos.coords;
        const { station, distanceM } = findNearest(latitude, longitude);
        source = "auto";

        let note = "";
        let kind = "ok";
        if (distanceM <= NEAR_M) {
          setGeoStatus(
            `已定位：你喺 <strong>${station.nameZh}</strong> 附近（約 ${formatDistance(
              distanceM
            )}）${
              accuracy
                ? ` · GPS 誤差約 ${Math.round(accuracy)} 米`
                : ""
            }`,
            "ok"
          );
          note = "偵測為附近車站";
        } else if (distanceM <= PICK_MAX_M) {
          setGeoStatus(
            `最近車站係 <strong>${station.nameZh}</strong>（約 ${formatDistance(
              distanceM
            )}）。若你其實喺另一站，可手動改選。`,
            "info"
          );
          note = "最近車站";
        } else {
          setGeoStatus(
            `最近係 <strong>${station.nameZh}</strong>，但距離約 ${formatDistance(
              distanceM
            )}，可能定位唔準。建議手動揀你嘅車站。`,
            "warn"
          );
          note = "距離較遠，請核對";
          kind = "warn";
        }

        selectStation(station, { distanceM, note });
      },
      (err) => {
        el.btnLocate.disabled = false;
        const msg =
          err.code === 1
            ? "你拒絕咗定位權限。請手動揀車站，或再撳「重新定位」。"
            : "定位失敗。請手動揀車站，或再試。";
        setGeoStatus(msg, "warn");
        // Default to a sensible station if none selected yet
        if (!currentCode) {
          const fallback = stationByCode("ADM") || STATIONS[0];
          source = "manual";
          selectStation(fallback, { note: "預設示範站（請改選或定位）" });
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  // Events
  el.btnLocate.addEventListener("click", () => locate());
  el.btnRefresh.addEventListener("click", () => {
    const s = stationByCode(currentCode);
    if (s) loadEta(s).catch(() => {});
  });
  el.stationSelect.addEventListener("change", () => {
    const code = el.stationSelect.value;
    if (!code) return;
    const s = stationByCode(code);
    if (!s) return;
    source = "manual";
    setGeoStatus(`已手動選擇：<strong>${s.nameZh}</strong>`, "info");
    selectStation(s, { note: "手動選擇" });
  });

  // Init
  fillStationSelect();
  setGeoStatus("準備定位，睇吓你附近邊個港鐵站…", "info");
  locate();
})();
