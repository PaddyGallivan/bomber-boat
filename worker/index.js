// bomber-boat-api v9.19 — 2026-04-27 (public bookings/count for SOLD-OUT detection)
// v9.15 — 2026-04-25 (STAFF_PASSWORD role: read + boarding only)
// v7: shared passwords — CAPTAIN_PASSWORD + ADMIN_PASSWORD secrets.
//  • Captain: types "bomberboatcaptain" → picks a game → checks people off. Server verifies against env.CAPTAIN_PASSWORD.
//  • Admin:   types "$Falkor2967" → full admin dashboard. Server verifies against env.ADMIN_PASSWORD.
//  • Old PIN system still works for granular per-game delegation; old X-API-Key path preserved for legacy /bomberboat-admin.
// v5: rename /checkin → /captain, build full /admin page (PIN mint + bookings + any-game check-off for admin)
// v4: captain PIN auth + hosted /checkin and /admin/pin pages
//  + POST /api/captain-pin  (admin creates game-scoped PIN with TTL)
//  + GET  /api/captain-pin  (admin lists active PINs)
//  + DELETE /api/captain-pin?pin=X  (admin revokes)
//  + POST /api/captain-login  (PIN → {game, captain_name, expires_at})
//  + X-Captain-PIN header accepted on /api/checkin + /api/roster, scoped to one game
//  + GET /checkin   — hosted mobile check-in page
//  + GET /admin/pin — admin page to mint PINs (needs X-API-Key)
//  + checked_in_by column on bookings is now written when captain checks in

var CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-API-Key,X-Captain-PIN,Authorization",
};
var jsonR = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: CORS });
var errR = (msg, status = 400) => jsonR({ error: msg }, status);

function requireApiKey(request, env) {
  const key =
    request.headers.get("X-API-Key") ||
    request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!key) return errR("Unauthorized", 401);
  if (key === env.API_KEY) return null;
  if (env.ADMIN_PASSWORD && key === env.ADMIN_PASSWORD) return null;
  if (env.CAPTAIN_PASSWORD && key === env.CAPTAIN_PASSWORD) return null;
  // v9.18: staff role — read-only + boarding tick-off (handler-level gates restrict writes)
  if (env.STAFF_PASSWORD && key === env.STAFF_PASSWORD) return null;
  return errR("Unauthorized", 401);
}

// Returns { mode:'admin' } | { mode:'captain', game, captain_name } | Response(401)
async function requireAdminOrCaptain(request, env) {
  // Admin paths: legacy X-API-Key OR new X-Admin-Password.
  const adminKey =
    request.headers.get("X-API-Key") ||
    request.headers.get("Authorization")?.replace("Bearer ", "");
  if (adminKey && adminKey === env.API_KEY) return { mode: "admin" };
  const adminPw = request.headers.get("X-Admin-Password");
  if (adminPw && env.ADMIN_PASSWORD && adminPw === env.ADMIN_PASSWORD) return { mode: "admin" };

  // Captain paths: shared password (with explicit ?game= in URL) OR game-scoped PIN.
  const captainPw = request.headers.get("X-Captain-Password");
  if (captainPw && env.CAPTAIN_PASSWORD && captainPw === env.CAPTAIN_PASSWORD) {
    const url = new URL(request.url);
    const game = url.searchParams.get("game");
    if (!game) return errR("Captain request missing ?game=", 400);
    // Verify game exists
    const gs = await env.DB.prepare(`SELECT game FROM game_settings WHERE game=?`).bind(game).first();
    if (!gs) return errR("Game not found", 404);
    return { mode: "captain", game, captain_name: "captain" };
  }

  const pin = request.headers.get("X-Captain-PIN");
  if (pin) {
    const row = await env.DB.prepare(
      `SELECT game, captain_name, expires_at
         FROM captain_pins
        WHERE pin = ? AND expires_at > datetime('now')`
    ).bind(pin).first();
    if (row) return { mode: "captain", game: row.game, captain_name: row.captain_name || "captain" };
  }
  return errR("Unauthorized", 401);
}

// Admin auth: accepts X-API-Key, X-Admin-Password, or Authorization: Bearer
// matching env.API_KEY or env.ADMIN_PASSWORD.
function requireAdmin(request, env) {
  const token =
    request.headers.get("X-API-Key") ||
    request.headers.get("Authorization")?.replace("Bearer ", "") ||
    request.headers.get("X-Admin-Password");
  if (!token) return errR("Unauthorized", 401);
  if (token === env.API_KEY) return null;
  if (env.ADMIN_PASSWORD && token === env.ADMIN_PASSWORD) return null;
  if (env.CAPTAIN_PASSWORD && token === env.CAPTAIN_PASSWORD) return null;
  // v9.15: staff allowed to read bookings + boarding (writes blocked at handler level for staff-only paths)
  if (env.STAFF_PASSWORD && token === env.STAFF_PASSWORD) return null;
  return errR("Unauthorized", 401);
}

function genToken(len = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let t = "";
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  for (const x of b) t += chars[x % chars.length];
  return t;
}

function genPin() {
  // Human-readable PIN: BOAT-XXXX (4 digits). 10k combinations per active game.
  const b = new Uint8Array(2);
  crypto.getRandomValues(b);
  const n = ((b[0] << 8) | b[1]) % 10000;
  return "BOAT-" + String(n).padStart(4, "0");
}

async function handleSchedule(env) {
  try {
    const games = await env.DB.prepare(
      `SELECT g.game, g.capacity, g.fare_mode, g.active,
              g.price_adult_return, g.price_child_return,
              g.price_adult_oneway, g.price_child_oneway,
              g.price_adult_oneway_from, g.price_child_oneway_from,
              g.boat_id, b.name AS boat_name, b.emoji AS boat_emoji
       FROM game_settings g LEFT JOIN boats b ON b.id = g.boat_id
       ORDER BY g.rowid ASC`
    ).all();
    // v9.6: per-game boats list
    const gameBoatsRows = await env.DB.prepare(
      `SELECT gb.game, gb.boat_id, b.name, b.capacity, b.emoji
       FROM game_boats gb LEFT JOIN boats b ON b.id = gb.boat_id
       ORDER BY gb.boat_id ASC`
    ).all();
    const boatsByGame = {};
    for (const r of gameBoatsRows.results || []) {
      if (!boatsByGame[r.game]) boatsByGame[r.game] = [];
      boatsByGame[r.game].push({ id: r.boat_id, name: r.name, capacity: r.capacity, emoji: r.emoji });
    }
    const counts = await env.DB.prepare(
      `SELECT game, fare, COUNT(*) as count FROM bookings GROUP BY game, fare`
    ).all();
    const countMap = {};
    for (const r of counts.results || []) {
      if (!countMap[r.game]) countMap[r.game] = { total: 0, return: 0, oneway_to: 0, oneway_from: 0 };
      countMap[r.game].total += r.count;
      if (r.fare === "return") countMap[r.game].return += r.count;
      else if (r.fare === "oneway_from") countMap[r.game].oneway_from += r.count;
      else countMap[r.game].oneway_to += r.count;
    }
    return jsonR({
      games: (games.results || []).map((g) => {
        const c = countMap[g.game] || { total: 0, return: 0, oneway_to: 0, oneway_from: 0 };
        return {
          game: g.game,
          capacity: g.capacity,
          fare_mode: g.fare_mode,
          active: g.active === 1 || g.active === true,
          price_adult_return: g.price_adult_return,
          price_child_return: g.price_child_return,
          price_adult_oneway: g.price_adult_oneway,
          price_child_oneway: g.price_child_oneway,
          price_adult_oneway_from: g.price_adult_oneway_from,
          price_child_oneway_from: g.price_child_oneway_from,
          boat_id: g.boat_id,
          boat_name: g.boat_name,
          boat_emoji: g.boat_emoji,
          booked: c.total,
          booked_return: c.return,
          booked_oneway_to: c.oneway_to,
          booked_oneway_from: c.oneway_from,
          booked_oneway: (c.oneway_to || 0) + (c.oneway_from || 0),
          // v9.6: multi-boat per game
          boats: boatsByGame[g.game] || [],
          fleet_capacity: (boatsByGame[g.game] || []).reduce((s,b) => s + (b.capacity||0), 0),
          // Per-direction availability: Return bookings take a seat BOTH ways.
          available_out:  Math.max(0, g.capacity - c.return - c.oneway_to),
          available_back: Math.max(0, g.capacity - c.return - c.oneway_from),
          available: g.capacity - c.total,
        };
      }),
      depart: "Riviera, Maribyrnong",
      boardTime: "10:50am",
      departTime: "11:00am",
      arriveTime: "12:00pm",
    });
  } catch (e) {
    return errR("Failed to load schedule", 500);
  }
}


// ─── Resend confirmation email ───────────────────────────────────────────
async function sendBookingEmail(env, booking, cancelToken, stripeUrl) {
  if (!env.RESEND_API_KEY || !booking.email) return { skipped: true };
  const fareLabel = booking.fare === 'return' ? 'Return (both ways)'
                  : booking.fare === 'oneway_from' ? 'Return leg only'
                  : 'One-way to game';
  const subject = `✈️ Bomber Boat booking confirmed — ${booking.game.replace(/\s*\(.*/, '').trim()}`;
  const cancelUrl = `https://bomberboat.com.au/?cancel=${encodeURIComponent(cancelToken)}`;
  const body = `
<div style="font-family:-apple-system,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#111">
  <div style="background:#CC2031;color:white;padding:24px;border-radius:12px;text-align:center">
    <h1 style="margin:0;font-size:22px;letter-spacing:1px">BOMBER BOAT</h1>
    <div style="font-size:13px;opacity:.9;margin-top:4px">Your booking is locked in — UP THE BOMBERS!</div>
  </div>
  <div style="margin-top:20px;padding:18px;background:#f7f7f9;border-radius:10px;font-size:14px;line-height:1.7">
    <div><b>Game:</b> ${booking.game}</div>
    <div><b>Fare:</b> ${fareLabel}</div>
    <div><b>Passengers:</b> ${booking.pass_type === 'child' ? 'Child/U18' : 'Adult'}</div>
    <div><b>Total:</b> $${booking.price}</div>
    <div><b>Payment:</b> ${booking.pay === 'stripe' ? 'Card (Stripe)' : 'Cash on board'}</div>
  </div>
  <div style="margin-top:18px;font-size:13px;color:#555;line-height:1.7">
    <p><b>🛥 Outbound — to the game</b><br>&nbsp;&nbsp;Board: <b>Riviera Cafe & Restaurant</b>, 55 Cumberland Dr, Maribyrnong VIC 3032 (boarding 10:50am, departs 11:00am).<br>&nbsp;&nbsp;Drop-off: <b>Victoria Harbour Pier, Docklands</b> — short walk (~5 min) to Marvel Stadium.<br><br><b>🛥 Return — back to Maribyrnong</b><br>&nbsp;&nbsp;Board: <b>Victoria Harbour Pier, Docklands</b> — boat departs 30 minutes after the final siren.<br>&nbsp;&nbsp;Drop-off: back at <b>Riviera Cafe & Restaurant</b>, Maribyrnong.<br>
    <b>What's included on the full-return fare:</b> free drink on arrival + finger food on board.</p>
    <div style="margin:20px 0;text-align:center;background:#fff;padding:18px;border:2px dashed #CC2031;border-radius:12px;"><div style="font-family:Arial,sans-serif;font-size:11px;letter-spacing:2px;color:#666;text-transform:uppercase;margin-bottom:10px;">Boarding Pass — show captain at the dock</div><img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=https%3A%2F%2Fbomberboat.com.au%2Fapi%2Fscan%3Fb%3D${booking.id}%26t%3D${cancelToken}" width="180" height="180" alt="Boarding QR" style="display:block;margin:0 auto;"><div style="font-family:Arial,sans-serif;font-size:11px;color:#666;margin-top:8px;">Booking #${booking.id}</div></div><p>Need to cancel? <a href="${cancelUrl}" style="color:#CC2031">Cancel this booking</a>.</p>
    ${stripeUrl ? `<p><b>Pay now:</b> <a href="${stripeUrl}" style="color:#CC2031">Complete payment</a></p>` : ''}
    <p style="color:#888;font-size:12px">Questions? Email <a href="mailto:hello@bomberboat.com.au" style="color:#CC2031">hello@bomberboat.com.au</a></p>
  </div>
</div>`.trim();
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Bomber Boat <bookings@bomberboat.com.au>',
        to: [booking.email],
        reply_to: 'pgallivan@outlook.com',
        subject,
        html: body,
      }),
    });
    const j = await r.json();
    return { ok: r.ok, id: j.id, error: j.message || j.error };
  } catch(e) {
    return { ok: false, error: String(e) };
  }
}

async function handleBook(request, env) {
  try {
    const body = await request.json();
    const { name, phone, email, game, fare, pass_type, pay, adults, u18, notes } = body;
    // Email-only booking: name/phone optional; email required for contact + Stripe receipt
    if (!email || !game || !fare) return errR("Email, game, and fare are required");
    const safeName = name || email;
    const safePhone = phone || "";
    const gs = await env.DB.prepare(
      `SELECT * FROM game_settings WHERE game = ?`
    ).bind(game).first();
    if (!gs) return errR("Game not found");
    if (!gs.active) return errR("This game is not currently open for bookings");
    const adultCount = parseInt(adults) || 1;
    const u18Count = parseInt(u18) || 0;
    const isReturn = fare === "return";
    const isOnewayFrom = fare === "oneway_from";
    // 3-tier pricing: return (both ways) | oneway_to (boat to game) | oneway_from (return leg only)
    let adultPrice, childPrice;
    if (isReturn) {
      adultPrice = gs.price_adult_return;
      childPrice = gs.price_child_return;
    } else if (isOnewayFrom) {
      adultPrice = gs.price_adult_oneway_from ?? gs.price_adult_oneway;
      childPrice = gs.price_child_oneway_from ?? gs.price_child_oneway;
    } else {
      adultPrice = gs.price_adult_oneway;
      childPrice = gs.price_child_oneway;
    }
    const totalPrice = adultCount * adultPrice + u18Count * childPrice;
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM bookings WHERE game = ?`
    ).bind(game).first();
    if ((countRow?.count || 0) + adultCount + u18Count > gs.capacity) {
      return errR("Sorry, this game is sold out");
    }
    const cancelToken = genToken();
    const booking = await env.DB.prepare(
      `INSERT INTO bookings (name, phone, email, game, fare, pass_type, pay, price, notes, cancel_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING *`
    ).bind(safeName, safePhone, email || "", game, fare, pass_type || "adult", pay || "cash",
      totalPrice, notes || "", cancelToken).first();
    let stripeUrl = null;
    if (env.STRIPE_SECRET_KEY && pay === "stripe") {
      try {
        const params = new URLSearchParams({
          mode: "payment",
          success_url: `https://bomberboat.com.au/?booked=1&booking=${booking.id}`,
          cancel_url: `https://bomberboat.com.au/?cancelled=1`,
          customer_email: email || "",
          client_reference_id: String(booking.id),
          "metadata[booking_id]": String(booking.id),
          "metadata[game]": game,
          "metadata[cancel_token]": cancelToken,
          "payment_method_types[]": "card",
        });
        if (adultCount > 0) {
          params.set(`line_items[0][price_data][currency]`, "aud");
          params.set(`line_items[0][price_data][product_data][name]`,
            `Bomber Boat — Adult ${isReturn ? "Return (both ways)" : isOnewayFrom ? "Return leg only" : "One-way to game"}`);
          params.set(`line_items[0][price_data][unit_amount]`, String(adultPrice * 100));
          params.set(`line_items[0][quantity]`, String(adultCount));
        }
        if (u18Count > 0) {
          const i = adultCount > 0 ? 1 : 0;
          params.set(`line_items[${i}][price_data][currency]`, "aud");
          params.set(`line_items[${i}][price_data][product_data][name]`,
            `Bomber Boat — U18 ${isReturn ? "Return (both ways)" : isOnewayFrom ? "Return leg only" : "One-way to game"}`);
          params.set(`line_items[${i}][price_data][unit_amount]`, String(childPrice * 100));
          params.set(`line_items[${i}][quantity]`, String(u18Count));
        }
        const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
        });
        const s = await sr.json();
        stripeUrl = s.url || null;
      } catch (e) {}
    }
    // Fire confirmation email (non-blocking on error — booking itself already saved)
    const emailResult = await sendBookingEmail(env, booking, cancelToken, stripeUrl);
    return jsonR({ booking, stripe_url: stripeUrl, cancel_token: cancelToken, email: emailResult }, 201);
  } catch (e) { return errR("Booking failed: " + e.message, 500); }
}

async function handleCancel(url, env) {
  const token = url.searchParams.get("token");
  if (!token) return errR("Missing token");
  const booking = await env.DB.prepare(
    `SELECT * FROM bookings WHERE cancel_token = ?`
  ).bind(token).first();
  if (!booking) return errR("Booking not found", 404);
  await env.DB.prepare(`DELETE FROM bookings WHERE cancel_token = ?`).bind(token).run();
  return jsonR({ success: true, message: `Booking for ${booking.name} cancelled` });
}

async function handleWaitlist(request, env) {
  try {
    const { name, phone, game, adults } = await request.json();
    if (!name || !phone || !game) return errR("Missing: name, phone, game");
    await env.DB.prepare(
      `INSERT INTO waitlist (name, phone, game, adults, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(name, phone, game, parseInt(adults) || 1).run();
    return jsonR({ success: true, message: `Added to waitlist for ${game}` }, 201);
  } catch (e) { return errR("Waitlist error: " + e.message, 500); }
}

async function handleGameSettings(request, env) {
  const a = requireAdmin(request, env); if (a) return a;
  if (request.method === "GET") {
    const games = await env.DB.prepare(
      `SELECT * FROM game_settings ORDER BY rowid ASC`
    ).all();
    return jsonR({ games: games.results || [] });
  }
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const { game, active, capacity, fare_mode,
        price_adult_return, price_child_return,
        price_adult_oneway, price_child_oneway,
        price_adult_oneway_from, price_child_oneway_from,
        boat_id } = body;
      if (!game) return errR("Missing game name");
      await env.DB.prepare(
        `UPDATE game_settings SET
          active=COALESCE(?,active), capacity=COALESCE(?,capacity),
          fare_mode=COALESCE(?,fare_mode),
          price_adult_return=COALESCE(?,price_adult_return),
          price_child_return=COALESCE(?,price_child_return),
          price_adult_oneway=COALESCE(?,price_adult_oneway),
          price_child_oneway=COALESCE(?,price_child_oneway),
          price_adult_oneway_from=COALESCE(?,price_adult_oneway_from),
          price_child_oneway_from=COALESCE(?,price_child_oneway_from),
          boat_id=COALESCE(?,boat_id),
          updated_at=datetime('now') WHERE game = ?`
      ).bind(
        active !== undefined ? (active ? 1 : 0) : null,
        capacity || null, fare_mode || null,
        price_adult_return || null, price_child_return || null,
        price_adult_oneway || null, price_child_oneway || null,
        price_adult_oneway_from || null, price_child_oneway_from || null,
        (boat_id === 0 ? null : (boat_id || null)),
        game
      ).run();
      const updated = await env.DB.prepare(`SELECT * FROM game_settings WHERE game=?`).bind(game).first();
      return jsonR({ success: true, game: updated });
    } catch (e) { return errR("Update failed: " + e.message, 500); }
  }
  return errR("Method not allowed", 405);
}

async function handleBookingsList(request, env) {
  const a = requireAdmin(request, env); if (a) return a;
  const url = new URL(request.url);
  const game = url.searchParams.get("game");
  const result = game
    ? await env.DB.prepare(`SELECT * FROM bookings WHERE game=? ORDER BY created_at DESC`).bind(game).all()
    : await env.DB.prepare(`SELECT * FROM bookings ORDER BY created_at DESC`).all();
  return jsonR({ bookings: result.results || [], count: result.results?.length || 0 });
}

async function handleWaitlistAdmin(request, env) {
  const a = requireAdmin(request, env); if (a) return a;
  const url = new URL(request.url);
  const game = url.searchParams.get("game");
  const result = game
    ? await env.DB.prepare(`SELECT * FROM waitlist WHERE game=? ORDER BY created_at ASC`).bind(game).all()
    : await env.DB.prepare(`SELECT * FROM waitlist ORDER BY created_at ASC`).all();
  return jsonR({ waitlist: result.results || [], count: result.results?.length || 0 });
}

// -------- NEW in v4: captain PIN management --------

async function handleCaptainPin(request, env) {
  const a = requireAdmin(request, env); if (a) return a;
  const url = new URL(request.url);
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id, game, pin, captain_name, expires_at, created_at, created_by
         FROM captain_pins
        WHERE expires_at > datetime('now')
        ORDER BY expires_at ASC`
    ).all();
    return jsonR({ active_pins: rows.results || [] });
  }
  if (request.method === "DELETE") {
    const pin = url.searchParams.get("pin");
    if (!pin) return errR("Missing pin");
    const r = await env.DB.prepare(`DELETE FROM captain_pins WHERE pin=?`).bind(pin).run();
    return jsonR({ success: true, deleted: r.meta?.changes || 0 });
  }
  if (request.method === "POST") {
    const b = await request.json();
    const game = b.game;
    const hours = Math.max(1, Math.min(parseInt(b.hours) || 12, 72));
    const captain_name = (b.captain_name || "").slice(0, 40);
    if (!game) return errR("Missing game");
    const gs = await env.DB.prepare(`SELECT game FROM game_settings WHERE game=?`).bind(game).first();
    if (!gs) return errR("Game not found");
    // Retry up to 5 times if we hit a PIN collision
    let pin = "";
    let attempt = 0;
    while (attempt < 5) {
      pin = b.pin ? String(b.pin).toUpperCase().slice(0, 20) : genPin();
      try {
        await env.DB.prepare(
          `INSERT INTO captain_pins (game, pin, captain_name, expires_at, created_by)
           VALUES (?, ?, ?, datetime('now', '+' || ? || ' hours'), 'admin')`
        ).bind(game, pin, captain_name, hours).run();
        break;
      } catch (e) {
        if (b.pin) return errR("PIN already taken, choose another", 409);
        attempt++;
      }
    }
    const row = await env.DB.prepare(
      `SELECT game, pin, captain_name, expires_at FROM captain_pins WHERE pin=?`
    ).bind(pin).first();
    return jsonR({ success: true, ...row, checkin_url: `${url.origin}/checkin?pin=${encodeURIComponent(pin)}` }, 201);
  }
  return errR("Method not allowed", 405);
}

// Captain exchanges PIN *or* shared password for game info.
// - PIN: returns the PIN's assigned game.
// - Shared password: returns list of all games (captain picks).
async function handleCaptainLogin(request, env) {
  try {
    const body = await request.json();
    const pin = body.pin || "";
    const password = body.password || "";

    // Shared password path
    if (password && env.CAPTAIN_PASSWORD && password === env.CAPTAIN_PASSWORD) {
      const games = await env.DB.prepare(
        `SELECT game, active, capacity FROM game_settings ORDER BY rowid ASC`
      ).all();
      return jsonR({
        ok: true,
        mode: "password",
        password_token: password,  // UI echoes this back as X-Captain-Password
        games: (games.results || []).map((g) => ({ game: g.game, active: g.active === 1 || g.active === true, capacity: g.capacity })),
      });
    }

    // PIN path (unchanged)
    if (pin) {
      const row = await env.DB.prepare(
        `SELECT game, captain_name, expires_at
           FROM captain_pins
          WHERE pin=? AND expires_at > datetime('now')`
      ).bind(pin).first();
      if (!row) return errR("Invalid or expired PIN", 401);
      return jsonR({ ok: true, mode: "pin", pin, game: row.game, captain_name: row.captain_name || "captain", expires_at: row.expires_at });
    }

    return errR("Missing password or pin", 400);
  } catch (e) { return errR("Login failed: " + e.message, 500); }
}

// Admin password login — just validates the password and echoes it back for the UI to store.
async function handleAdminLogin(request, env) {
  try {
    const { password } = await request.json();
    if (!password) return errR("Missing password");
    if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) return errR("Invalid password", 401);
    return jsonR({ ok: true, password_token: password });
  } catch (e) { return errR("Login failed: " + e.message, 500); }
}

async function handleCheckin(request, env) {
  const auth = await requireAdminOrCaptain(request, env);
  if (auth instanceof Response) return auth;
  try {
    const { booking_id, undo } = await request.json();
    if (!booking_id) return errR("Missing booking_id");
    // Captains can only check in bookings for their assigned game
    if (auth.mode === "captain") {
      const b = await env.DB.prepare(`SELECT game FROM bookings WHERE id=?`).bind(booking_id).first();
      if (!b) return errR("Booking not found", 404);
      if (b.game !== auth.game) return errR("Booking not for your game", 403);
    }
    const by = auth.mode === "captain" ? (auth.captain_name || "captain") : "admin";
    if (undo) {
      await env.DB.prepare(
        `UPDATE bookings SET checked_in=NULL, checked_in_by='' WHERE id=?`
      ).bind(booking_id).run();
    } else {
      await env.DB.prepare(
        `UPDATE bookings SET checked_in=datetime('now'), checked_in_by=? WHERE id=?`
      ).bind(by, booking_id).run();
    }
    const row = await env.DB.prepare(
      `SELECT id, name, phone, game, fare, pass_type, price, checked_in, checked_in_by FROM bookings WHERE id=?`
    ).bind(booking_id).first();
    return jsonR({ success: true, booking: row });
  } catch (e) { return errR("Checkin error: " + e.message, 500); }
}

async function handleRoster(request, env) {
  const auth = await requireAdminOrCaptain(request, env);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  let game = url.searchParams.get("game");
  if (auth.mode === "captain") {
    // captains always see their own game, ignore ?game=
    game = auth.game;
  }
  if (!game) return errR("Missing game");
  const r = await env.DB.prepare(
    `SELECT id, name, phone, fare, pass_type, price, pay, notes, checked_in, checked_in_by, created_at
       FROM bookings WHERE game=?
     ORDER BY (checked_in IS NULL) DESC, name ASC`
  ).bind(game).all();
  const rows = r.results || [];
  const ret = rows.filter((b) => b.fare === "return");
  const ow = rows.filter((b) => b.fare !== "return");
  return jsonR({
    game,
    captain_name: auth.mode === "captain" ? auth.captain_name : null,
    total: rows.length,
    checked_in: rows.filter((b) => b.checked_in).length,
    remaining: rows.filter((b) => !b.checked_in).length,
    return_count: ret.length,
    oneway_count: ow.length,
    return_checked_in: ret.filter((b) => b.checked_in).length,
    oneway_checked_in: ow.filter((b) => b.checked_in).length,
    bookings: rows,
  });
}

async function handleFalkorFeed(env) {
  const result = await handleSchedule(env);
  const data = await result.clone().json();
  const upcoming = (data.games || [])
    .filter((g) => g.active)
    .map((g) => ({
      game: g.game, available: g.available, capacity: g.capacity,
      price_adult: g.price_adult_return, price_u18: g.price_child_return,
      depart: "Riviera, Maribyrnong",
      boardTime: "10:50am", departTime: "11:00am", arriveTime: "12:00pm",
    }));
  return jsonR({ upcoming, source: "bomber-boat-api" });
}

// -------- HTML pages --------

const CHECKIN_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Bomber Boat — Captain Check-in</title>
<style>
:root{--red:#E2181A;--ink:#0b0b0b;--grey:#f4f4f4;--green:#2ba83b}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;color:var(--ink);background:#fff}
header{background:var(--red);color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
header h1{font-size:16px;margin:0;font-weight:800;letter-spacing:.3px}
.counter{font-size:13px;opacity:.9;text-align:right}
.counter b{display:block;font-size:17px}
.login{padding:28px 18px;max-width:420px;margin:0 auto}
.login h2{font-size:20px;margin:6px 0 4px;text-align:center}
.login p{color:#555;font-size:13px;margin:0 0 18px;text-align:center}
.login label{font-size:12px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:.5px}
.login input,.login select{width:100%;font-size:17px;padding:12px;border-radius:10px;border:1.5px solid #ccc;margin-bottom:12px}
.login button{width:100%;padding:13px;border:none;background:var(--ink);color:#fff;font-size:15px;font-weight:700;border-radius:10px}
.hint{color:#888;font-size:12px;margin-top:10px;text-align:center}
.controls{padding:10px 12px;background:var(--grey);display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.controls input{font-size:15px;padding:9px 12px;border-radius:8px;border:1px solid #ccc;background:#fff;flex:1;min-width:160px}
.controls button{padding:9px 12px;border-radius:8px;border:none;background:var(--ink);color:#fff;font-weight:700;font-size:13px}
.summary{padding:8px 12px;font-size:12px;color:#444;background:#fafafa;border-bottom:1px solid #eee}
.summary b{color:var(--ink)}
#list{padding:6px 8px 100px}
.row{display:flex;align-items:center;justify-content:space-between;padding:13px 12px;border-bottom:1px solid #eee;gap:10px}
.row .who{flex:1;min-width:0}
.row .who b{display:block;font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .who small{color:#555;font-size:12px;display:block;margin-top:2px}
.tick{min-width:92px;height:46px;border-radius:10px;border:1px solid #ccc;background:#fff;font-weight:800;font-size:14px}
.row.done{background:#eaf8ed}
.row.done .tick{background:var(--green);color:#fff;border-color:var(--green)}
.empty{padding:40px 16px;text-align:center;color:#666}
.err{padding:10px 14px;background:#ffe9e9;color:#a00;font-size:13px}
.footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #eee;padding:8px 14px;display:flex;justify-content:space-between;font-size:11px;color:#888}
</style></head>
<body>
<div id="app"></div>
<script>
const API = location.origin;
let PWD = sessionStorage.getItem('bb_captain_pwd') || '';
let GAME = sessionStorage.getItem('bb_game') || '';
let CAPTAIN = sessionStorage.getItem('bb_captain') || 'captain';
let BOOKINGS = [];

function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function showErr(msg){const e=document.getElementById('err');if(!e)return;if(!msg){e.style.display='none';e.textContent='';return;}e.style.display='block';e.textContent=msg;}

function renderLogin(defaultPwd, games, errMsg){
  const app = document.getElementById('app');
  app.innerHTML = \`
    <header><h1>Bomber Boat · Captain Check-in</h1></header>
    <div class="login">
      <h2>Captain login</h2>
      <p>Enter the captain password to board today\'s guests</p>
      \${errMsg ? '<div class="err">' + esc(errMsg) + '</div>' : ''}
      <label>Password</label>
      <input id="pwd" type="password" value="\${esc(defaultPwd||'')}" placeholder="captain password">
      \${games && games.length ? \`
        <label>Game</label>
        <select id="game">
          \${games.map((g,i)=>\`<option value="\${encodeURIComponent(g.game)}" \${g.active?'selected':''}>\${g.active?'★ ':''}\${esc(g.game)}</option>\`).join('')}
        </select>
      \`:''}
      <button onclick="doLogin()">Log in</button>
      <div class="hint">Captain password comes from Paddy. One password for every game — pick the right game from the list.</div>
    </div>\`;
  setTimeout(()=>{document.getElementById('pwd').focus();},100);
  document.getElementById('pwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin(){
  const pwd = document.getElementById('pwd').value.trim();
  if (!pwd) return;
  const gameSel = document.getElementById('game');
  if (!gameSel) {
    // First pass: exchange password for list of games
    try {
      const r = await fetch(API + '/api/captain-login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd })});
      const d = await r.json();
      if (!r.ok || !d.ok) { renderLogin(pwd, null, d.error || 'Wrong password'); return; }
      renderLogin(pwd, d.games);
    } catch(e) { renderLogin(pwd, null, 'Login error: ' + e.message); }
  } else {
    // Second pass: user picked a game
    PWD = pwd;
    GAME = decodeURIComponent(gameSel.value);
    CAPTAIN = 'captain';
    sessionStorage.setItem('bb_captain_pwd', PWD);
    sessionStorage.setItem('bb_game', GAME);
    sessionStorage.setItem('bb_captain', CAPTAIN);
    renderBoard();
    loadRoster();
  }
}

function logout(){ sessionStorage.clear(); PWD=''; GAME=''; CAPTAIN=''; BOOKINGS=[]; renderLogin(); }

async function api(path, opts={}){
  const sep = path.includes('?') ? '&' : '?';
  const url = API + path + sep + 'game=' + encodeURIComponent(GAME);
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers||{}), 'X-Captain-Password': PWD, 'Content-Type':'application/json' } });
  if (r.status === 401 || r.status === 400) throw new Error('Session invalid — please log in again');
  if (!r.ok) { const t = await r.text(); throw new Error(t || ('HTTP ' + r.status)); }
  return r.json();
}

function renderBoard(){
  document.getElementById('app').innerHTML = \`
    <header>
      <h1>\${esc(GAME.length>36?GAME.slice(0,36)+'…':GAME)}</h1>
      <div class="counter"><b id="count">– / –</b>\${esc(CAPTAIN)}</div>
    </header>
    <div class="controls">
      <input id="search" type="search" placeholder="Search name…" oninput="render()">
      <button onclick="loadRoster()">↻</button>
      <button onclick="logout()" style="background:#888">Log out</button>
    </div>
    <div class="summary" id="summary">Loading…</div>
    <div id="err" class="err" style="display:none"></div>
    <div id="list"></div>
    <div class="footer"><span>Bomber Boat</span><span>Captain: \${esc(CAPTAIN)}</span></div>\`;
}

async function loadRoster(){
  if (!PWD || !GAME) return renderLogin();
  showErr('');
  try {
    const d = await api('/api/roster');
    BOOKINGS = d.bookings || [];
    document.getElementById('count').textContent = d.checked_in + ' / ' + d.total;
    document.getElementById('summary').innerHTML =
      '<b>' + d.checked_in + '</b> boarded · <b>' + d.remaining + '</b> to go · Return: ' + d.return_checked_in + '/' + d.return_count + ' · One-way: ' + d.oneway_checked_in + '/' + d.oneway_count;
    render();
  } catch(e) { showErr(e.message); if (/invalid|Unauthorized/i.test(e.message)) setTimeout(logout, 1500); }
}

function render(){
  const q = (document.getElementById('search')?.value || '').trim().toLowerCase();
  const list = document.getElementById('list');
  const rows = BOOKINGS.filter(b => !q || b.name.toLowerCase().includes(q) || (b.phone||'').includes(q));
  if (!rows.length){ list.innerHTML = '<div class="empty">No bookings match.</div>'; return; }
  list.innerHTML = rows.map(b => \`
    <div class="row \${b.checked_in ? 'done' : ''}" id="r\${b.id}">
      <div class="who">
        <b>\${esc(b.name)}</b>
        <small>\${esc(b.fare || '')} · \${esc(b.pass_type || '')} · $\${b.price || 0}\${b.phone?' · '+esc(b.phone):''}\${b.notes?' · '+esc(b.notes):''}\${b.checked_in_by?' · by '+esc(b.checked_in_by):''}</small>
      </div>
      <button class="tick" onclick="toggle(\${b.id}, \${!!b.checked_in})">\${b.checked_in ? '✓ Boarded' : 'Check in'}</button>
    </div>\`).join('');
}

async function toggle(id, was){
  try {
    const d = await api('/api/checkin', { method:'POST', body: JSON.stringify({ booking_id:id, undo: was })});
    const i = BOOKINGS.findIndex(b => b.id === id);
    if (i >= 0) { BOOKINGS[i].checked_in = d.booking.checked_in; BOOKINGS[i].checked_in_by = d.booking.checked_in_by; }
    const done = BOOKINGS.filter(b=>b.checked_in).length;
    document.getElementById('count').textContent = done + ' / ' + BOOKINGS.length;
    const ret = BOOKINGS.filter(b=>b.fare==='return');
    const ow = BOOKINGS.filter(b=>b.fare!=='return');
    document.getElementById('summary').innerHTML =
      '<b>' + done + '</b> boarded · <b>' + (BOOKINGS.length-done) + '</b> to go · Return: ' + ret.filter(b=>b.checked_in).length + '/' + ret.length + ' · One-way: ' + ow.filter(b=>b.checked_in).length + '/' + ow.length;
    render();
  } catch(e) { showErr(e.message); }
}

if (PWD && GAME) { renderBoard(); loadRoster(); }
else { renderLogin(PWD); }
</script></body></html>`;

const ADMIN_PIN_HTML_OLD = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bomber Boat — Mint captain PIN</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;max-width:540px;margin:0 auto;padding:18px;color:#111}
h1{font-size:20px;margin:0 0 4px}
p.sub{color:#666;margin:0 0 16px;font-size:13px}
label{display:block;font-size:12px;font-weight:700;margin:10px 0 4px;color:#444;text-transform:uppercase;letter-spacing:.5px}
input,select,button{width:100%;padding:10px;border-radius:8px;border:1px solid #ccc;font-size:14px}
button{background:#0b0b0b;color:#fff;border:none;font-weight:700;margin-top:14px;padding:12px}
.card{margin-top:14px;padding:12px;border:1px solid #ddd;border-radius:10px}
.pin-big{font-family:monospace;font-size:28px;letter-spacing:3px;font-weight:800;text-align:center;padding:10px;background:#fffbe6;border-radius:8px}
.small{font-size:12px;color:#555}
.active-list{margin-top:24px}
.pin-row{display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #eee;gap:8px}
.pin-row code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-family:monospace}
.pin-row button{width:auto;padding:4px 10px;background:#c33;font-size:12px}
.err{color:#a00;font-size:13px;margin-top:8px}
.copy{background:#eee;color:#111;font-size:12px;padding:4px 8px;border:1px solid #ccc;border-radius:4px;cursor:pointer;width:auto;margin-top:8px}
</style></head>
<body>
<h1>Mint captain PIN</h1>
<p class="sub">Creates a PIN that lets someone access <code>/checkin</code> for one game only, for a limited time. Requires admin API key.</p>

<label>Admin password (stored in this browser only)</label>
<input id="key" type="password" placeholder="admin password" value="">

<label>Game</label>
<select id="game"><option>Loading…</option></select>

<label>Captain name (optional)</label>
<input id="name" placeholder="e.g. Paddy, Con, Dave">

<label>Valid for (hours)</label>
<input id="hours" type="number" value="12" min="1" max="72">

<label>Custom PIN (optional — leave blank for auto BOAT-XXXX)</label>
<input id="pin" placeholder="auto">

<button onclick="mint()">Create PIN</button>
<div id="out"></div>

<div class="active-list">
  <h2 style="font-size:15px;margin-top:28px">Active PINs</h2>
  <div id="active">Enter API key above to load.</div>
</div>

<script>
const API = location.origin;
let KEY = sessionStorage.getItem('bb_admin_key') || '';
document.getElementById('key').value = KEY;
document.getElementById('key').addEventListener('change', e => {
  KEY = e.target.value.trim();
  sessionStorage.setItem('bb_admin_key', KEY);
  loadGames(); loadActive();
});

async function loadGames(){
  try {
    const r = await fetch(API + '/api/schedule');
    const d = await r.json();
    const sel = document.getElementById('game');
    sel.innerHTML = d.games.map(g => \`<option value="\${encodeURIComponent(g.game)}">\${g.active?'★ ':''}\${g.game}</option>\`).join('');
  } catch(e){}
}
async function loadActive(){
  if (!KEY) return;
  try {
    const r = await fetch(API + '/api/captain-pin', { headers:{'X-API-Key': KEY}});
    const d = await r.json();
    if (!r.ok) { document.getElementById('active').innerHTML = '<span class="err">'+(d.error||'error')+'</span>'; return; }
    const pins = d.active_pins || [];
    if (!pins.length) { document.getElementById('active').textContent = 'No active PINs.'; return; }
    document.getElementById('active').innerHTML = pins.map(p =>
      \`<div class="pin-row"><div><code>\${p.pin}</code> — \${p.game.slice(0,28)}… <span class="small">\${p.captain_name||''} · exp \${p.expires_at}</span></div><button onclick="revoke('\${p.pin}')">Revoke</button></div>\`
    ).join('');
  } catch(e){}
}
async function revoke(pin){
  if (!confirm('Revoke ' + pin + '?')) return;
  await fetch(API + '/api/captain-pin?pin=' + encodeURIComponent(pin), { method:'DELETE', headers:{'X-API-Key': KEY}});
  loadActive();
}
async function mint(){
  KEY = document.getElementById('key').value.trim();
  sessionStorage.setItem('bb_admin_key', KEY);
  const gameEnc = document.getElementById('game').value;
  const body = {
    game: decodeURIComponent(gameEnc),
    captain_name: document.getElementById('name').value.trim(),
    hours: parseInt(document.getElementById('hours').value) || 12,
    pin: document.getElementById('pin').value.trim() || undefined,
  };
  const r = await fetch(API + '/api/captain-pin', {
    method:'POST',
    headers:{'Content-Type':'application/json','X-API-Key': KEY},
    body: JSON.stringify(body)
  });
  const d = await r.json();
  const out = document.getElementById('out');
  if (!r.ok) { out.innerHTML = '<div class="err">'+(d.error||'Error')+'</div>'; return; }
  out.innerHTML = \`
    <div class="card">
      <div class="pin-big">\${d.pin}</div>
      <div class="small" style="margin-top:8px"><b>Game:</b> \${d.game}</div>
      <div class="small"><b>Captain:</b> \${d.captain_name||'(any)'}</div>
      <div class="small"><b>Expires:</b> \${d.expires_at}</div>
      <div class="small" style="margin-top:10px"><b>Share this link:</b></div>
      <input readonly value="\${d.checkin_url}" style="margin-top:4px">
      <button class="copy" onclick="navigator.clipboard.writeText('\${d.checkin_url}');this.textContent='Copied ✓'">Copy link</button>
    </div>\`;
  loadActive();
}

if (KEY) { loadActive(); }
loadGames();
</script></body></html>`;


const ADMIN_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bomber Boat — Admin</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#111;background:#f6f7f9}
header{background:#E2181A;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
header h1{font-size:18px;margin:0;font-weight:800;letter-spacing:.3px}
nav{display:flex;gap:4px;padding:8px 14px;background:#fff;border-bottom:1px solid #eee;overflow-x:auto}
nav button{padding:8px 14px;border:none;background:transparent;font-size:13px;font-weight:600;cursor:pointer;border-radius:6px;color:#555;white-space:nowrap}
nav button.active{background:#111;color:#fff}
.container{max-width:720px;margin:0 auto;padding:14px}
.card{background:#fff;border:1px solid #e3e3e8;border-radius:10px;padding:16px;margin-bottom:14px}
label{display:block;font-size:11px;font-weight:700;margin:10px 0 4px;color:#444;text-transform:uppercase;letter-spacing:.5px}
input,select,textarea,button{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #ccc;font-size:14px;background:#fff}
button.primary{background:#111;color:#fff;border:none;font-weight:700;margin-top:10px;padding:12px}
button.danger{background:#c33;color:#fff;border:none;font-size:12px;padding:6px 10px;width:auto}
button.small{width:auto;padding:6px 10px;font-size:12px;background:#eee;color:#111;border:1px solid #ccc}
.row{display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #eee;gap:10px}
.row .who{flex:1;min-width:0}
.row .who b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row .who small{color:#666;font-size:12px}
.row.done{background:#eaf8ed}
.tick{min-width:92px;height:40px;border-radius:8px;border:1px solid #ccc;background:#fff;font-weight:700;font-size:13px}
.row.done .tick{background:#2ba83b;color:#fff;border-color:#2ba83b}
.pin-big{font-family:monospace;font-size:28px;letter-spacing:3px;font-weight:800;text-align:center;padding:12px;background:#fffbe6;border-radius:8px;margin:10px 0}
.summary{background:#f0f4ff;border:1px solid #dbe4ff;border-radius:8px;padding:10px;font-size:13px;margin-bottom:12px}
.summary b{color:#000}
.err{color:#a00;font-size:13px;padding:8px;background:#ffe9e9;border-radius:6px;margin:8px 0}
.ok{color:#060;font-size:13px;padding:8px;background:#e9ffec;border-radius:6px;margin:8px 0}
.hide{display:none}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
table{width:100%;font-size:13px;border-collapse:collapse}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eee}
th{font-size:11px;text-transform:uppercase;color:#777;letter-spacing:.5px}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;font-weight:700;background:#eee;color:#333}
.pill.ret{background:#dff5e0;color:#060}
.pill.ow{background:#fde9c9;color:#724}
.code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-family:monospace}
</style></head>
<body>
<header>
  <h1>Bomber Boat · Admin</h1>
  <div id="adminwho" style="font-size:12px;opacity:.9"></div>
</header>
<nav>
  <button class="active" data-tab="boarding" onclick="tab('boarding')">Boarding</button>
  <button data-tab="pins" onclick="tab('pins')">Captain PINs</button>
  <button data-tab="bookings" onclick="tab('bookings')">All bookings</button>
  <button data-tab="games" onclick="tab('games')">Games</button>
  <button data-tab="key" onclick="tab('key')">API key</button>
</nav>
<div class="container">

<!-- API KEY TAB -->
<div id="t-key" class="card hide">
  <label>Admin password (stored in this browser only)</label>
  <input id="key" type="password" placeholder="admin password" value="">
  <button class="primary" onclick="saveKey()">Save</button>
  <p style="color:#666;font-size:12px;margin-top:8px">The same API_KEY secret used by /api/* admin endpoints.</p>
</div>

<!-- BOARDING TAB -->
<div id="t-boarding" class="card">
  <label>Game</label>
  <select id="b-game" onchange="loadBoarding()"><option>Loading…</option></select>
  <div id="b-summary" class="summary" style="display:none"></div>
  <div id="b-search-wrap" style="display:none"><input id="b-search" type="search" placeholder="Search name or phone…" oninput="renderBoarding()"></div>
  <div id="b-list"></div>
</div>

<!-- PINS TAB -->
<div id="t-pins" class="card hide">
  <h3 style="margin:0 0 10px">Mint captain PIN</h3>
  <label>Game</label>
  <select id="p-game"></select>
  <div class="grid2">
    <div>
      <label>Captain name (optional)</label>
      <input id="p-name" placeholder="e.g. Paddy, Con, Dave">
    </div>
    <div>
      <label>Valid for (hours)</label>
      <input id="p-hours" type="number" value="12" min="1" max="72">
    </div>
  </div>
  <label>Custom PIN (optional)</label>
  <input id="p-pin" placeholder="auto-generates BOAT-XXXX">
  <button class="primary" onclick="mintPin()">Create PIN</button>
  <div id="p-out"></div>
  <h3 style="margin:20px 0 8px;font-size:14px">Active PINs</h3>
  <div id="p-active">—</div>
</div>

<!-- BOOKINGS TAB -->
<div id="t-bookings" class="card hide">
  <label>Filter by game (optional)</label>
  <select id="bk-game"><option value="">All games</option></select>
  <button class="small" onclick="loadBookings()">Refresh</button>
  <div style="overflow-x:auto;margin-top:12px"><table id="bk-table"><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Game</th><th>Fare</th><th>$</th><th>In?</th></tr></thead><tbody id="bk-body"></tbody></table></div>
</div>

<!-- GAMES TAB -->
<div id="t-games" class="card hide">
  <h3 style="margin:0 0 10px;font-size:14px">Game settings</h3>
  <div id="g-list">—</div>
</div>

</div>

<script>
const API = location.origin;
let KEY = sessionStorage.getItem('bb_admin_key') || '';
let GAMES = [];
let BOARDING = null;
let CUR = 'boarding';

function $(id){return document.getElementById(id)}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function tab(n){CUR=n;document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===n));['boarding','pins','bookings','games','key'].forEach(t=>$('t-'+t).classList.toggle('hide',t!==n));if(n==='pins')loadActivePins();if(n==='bookings')loadBookings();if(n==='games')loadGameSettings();}

async function api(path, opts={}){
  if(!KEY){ tab('key'); alert('Enter admin password first'); throw new Error('no key'); }
  const r = await fetch(API+path,{...opts,headers:{...(opts.headers||{}),'X-API-Key':KEY,'Content-Type':'application/json'}});
  if(r.status===401){ alert('Admin password rejected'); throw new Error('401'); }
  const t = await r.text();
  try{return JSON.parse(t)}catch(e){return t}
}
async function publicApi(path){const r=await fetch(API+path);return r.json()}

function saveKey(){
  KEY = $('key').value.trim();
  sessionStorage.setItem('bb_admin_key', KEY);
  $('adminwho').textContent = KEY ? 'Admin logged in' : '';
  tab('boarding');
  init();
}

async function init(){
  const d = await publicApi('/api/schedule');
  GAMES = d.games || [];
  const opts = GAMES.map(g=>\`<option value="\${encodeURIComponent(g.game)}">\${g.active?'★ ':''}\${esc(g.game)}</option>\`).join('');
  $('b-game').innerHTML = opts;
  $('p-game').innerHTML = opts;
  $('bk-game').innerHTML = '<option value="">All games</option>' + opts;
  // pick first active
  const active = GAMES.findIndex(g=>g.active);
  if (active>=0) { $('b-game').selectedIndex = active; $('p-game').selectedIndex = active; }
  loadBoarding();
}

async function loadBoarding(){
  const gameEnc = $('b-game').value;
  if (!gameEnc) return;
  try {
    const d = await api('/api/roster?game='+gameEnc);
    BOARDING = d;
    $('b-summary').style.display = 'block';
    $('b-search-wrap').style.display = 'block';
    $('b-summary').innerHTML = \`<b>\${d.checked_in}/\${d.total}</b> boarded — <b>\${d.remaining}</b> to go · Return: \${d.return_checked_in}/\${d.return_count} · One-way: \${d.oneway_checked_in}/\${d.oneway_count}\`;
    renderBoarding();
  } catch(e){ $('b-list').innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
}

function renderBoarding(){
  if (!BOARDING) return;
  const q = ($('b-search').value||'').trim().toLowerCase();
  const rows = (BOARDING.bookings||[]).filter(b=>!q||(b.name||'').toLowerCase().includes(q)||(b.email||'').toLowerCase().includes(q)||(b.phone||'').includes(q));
  if (!rows.length){ $('b-list').innerHTML = '<div style="padding:30px;text-align:center;color:#666">No bookings.</div>'; return; }
  $('b-list').innerHTML = rows.map(b=>\`
    <div class="row \${b.checked_in?'done':''}" id="br\${b.id}">
      <div class="who">
        <b>\${esc(b.name||b.email||'(no name)')}</b>
        <small>\${esc(b.fare||'')} · \${esc(b.pass_type||'')} · $\${b.price||0}\${b.email?' · '+esc(b.email):''}\${b.phone?' · '+esc(b.phone):''}\${b.notes?' · '+esc(b.notes):''}\${b.checked_in_by?' · by '+esc(b.checked_in_by):''}</small>
      </div>
      <button class="tick" onclick="toggleBoarding(\${b.id}, \${!!b.checked_in})">\${b.checked_in?'✓ Boarded':'Check in'}</button>
    </div>\`).join('');
}

async function toggleBoarding(id, was){
  try {
    const d = await api('/api/checkin', {method:'POST', body:JSON.stringify({booking_id:id, undo:was})});
    const i = BOARDING.bookings.findIndex(b=>b.id===id);
    if (i>=0){ BOARDING.bookings[i].checked_in = d.booking.checked_in; BOARDING.bookings[i].checked_in_by = d.booking.checked_in_by; }
    BOARDING.checked_in = BOARDING.bookings.filter(b=>b.checked_in).length;
    BOARDING.remaining = BOARDING.total - BOARDING.checked_in;
    const ret = BOARDING.bookings.filter(b=>b.fare==='return');
    const ow = BOARDING.bookings.filter(b=>b.fare!=='return');
    BOARDING.return_checked_in = ret.filter(b=>b.checked_in).length;
    BOARDING.oneway_checked_in = ow.filter(b=>b.checked_in).length;
    $('b-summary').innerHTML = \`<b>\${BOARDING.checked_in}/\${BOARDING.total}</b> boarded — <b>\${BOARDING.remaining}</b> to go · Return: \${BOARDING.return_checked_in}/\${BOARDING.return_count} · One-way: \${BOARDING.oneway_checked_in}/\${BOARDING.oneway_count}\`;
    renderBoarding();
  } catch(e){ alert(e.message); }
}

async function mintPin(){
  const gameEnc = $('p-game').value;
  const body = {
    game: decodeURIComponent(gameEnc),
    captain_name: $('p-name').value.trim(),
    hours: parseInt($('p-hours').value)||12,
    pin: ($('p-pin').value.trim())||undefined,
  };
  try {
    const d = await api('/api/captain-pin', {method:'POST', body:JSON.stringify(body)});
    if (d.error){ $('p-out').innerHTML = '<div class="err">'+esc(d.error)+'</div>'; return; }
    $('p-out').innerHTML = \`
      <div class="card" style="margin-top:14px">
        <div class="pin-big">\${esc(d.pin)}</div>
        <div style="font-size:13px">Game: <b>\${esc(d.game)}</b></div>
        <div style="font-size:13px">Captain: \${esc(d.captain_name||'(any)')}</div>
        <div style="font-size:13px">Expires: \${esc(d.expires_at)}</div>
        <label>Shareable link</label>
        <input readonly value="\${esc(d.checkin_url.replace('/checkin','/captain'))}">
        <button class="small" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);this.textContent='Copied ✓'">Copy link</button>
      </div>\`;
    loadActivePins();
  } catch(e){ $('p-out').innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
}

async function loadActivePins(){
  try {
    const d = await api('/api/captain-pin');
    const pins = d.active_pins || [];
    if (!pins.length){ $('p-active').textContent = 'No active PINs.'; return; }
    $('p-active').innerHTML = pins.map(p=>\`
      <div class="row">
        <div class="who"><b><span class="code">\${esc(p.pin)}</span></b><small>\${esc(p.game.slice(0,40))}… · \${esc(p.captain_name||'(any)')} · exp \${esc(p.expires_at)}</small></div>
        <button class="danger" onclick="revoke('\${esc(p.pin)}')">Revoke</button>
      </div>\`).join('');
  } catch(e){ $('p-active').innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
}

async function revoke(pin){
  if (!confirm('Revoke '+pin+'?')) return;
  await api('/api/captain-pin?pin='+encodeURIComponent(pin), {method:'DELETE'});
  loadActivePins();
}

async function loadBookings(){
  const game = $('bk-game').value;
  try {
    const d = await api('/api/bookings'+(game?('?game='+game):''));
    const rows = d.bookings || [];
    $('bk-body').innerHTML = rows.map(b=>\`<tr>
      <td>\${b.id}</td>
      <td>\${esc(b.name||'—')}</td>
      <td><small>\${b.email?esc(b.email):'<span style=\"color:#aaa\">—</span>'}</small></td>
      <td><small>\${esc((b.game||'').slice(0,30))}…</small></td>
      <td><span class="pill \${b.fare==='return'?'ret':'ow'}">\${esc(b.fare||'')}</span></td>
      <td>$\${b.price||0}</td>
      <td>\${b.checked_in?'✓':'–'}</td>
    </tr>\`).join('');
  } catch(e){ $('bk-body').innerHTML = '<tr><td colspan=7><div class="err">'+esc(e.message)+'</div></td></tr>'; }
}

async function loadGameSettings(){
  try {
    const d = await api('/api/game-settings');
    $('g-list').innerHTML = (d.games||[]).map((g,i)=>\`
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
          <b style="font-size:14px;flex:1;line-height:1.3">\${esc(g.game)}</b>
          <button class="small" onclick="toggleActive('\${encodeURIComponent(g.game)}',\${g.active?0:1})" style="background:\${g.active?'#2ba83b':'#ddd'};color:\${g.active?'#fff':'#333'};border:none">
            \${g.active?'★ ACTIVE':'inactive'} \${g.active?'· click to deactivate':'· click to activate'}
          </button>
        </div>
        <div style="font-size:12px;color:#777;margin-bottom:6px">Capacity · Fare mode · Prices — tap Save after editing</div>
        <div class="grid2">
          <div>
            <label>Capacity</label>
            <input id="gs-cap-\${i}" type="number" value="\${g.capacity||60}" min="1" max="500">
          </div>
          <div>
            <label>Fare mode</label>
            <select id="gs-fm-\${i}">
              <option value="both" \${g.fare_mode==='both'?'selected':''}>All fares</option>
              <option value="return_only" \${g.fare_mode==='return_only'?'selected':''}>Return only</option>
              <option value="oneway_to_only" \${g.fare_mode==='oneway_to_only'?'selected':''}>One-way only</option>
            </select>
          </div>
        </div>
        <div class="grid2">
          <div>
            <label>Return $ (both-ways) — adult / child</label>
            <div style="display:flex;gap:6px">
              <input id="gs-ar-\${i}" type="number" value="\${g.price_adult_return??90}" placeholder="90">
              <input id="gs-cr-\${i}" type="number" value="\${g.price_child_return??40}" placeholder="40">
            </div>
          </div>
          <div>
            <label>One-way to $ — adult / child</label>
            <div style="display:flex;gap:6px">
              <input id="gs-ao-\${i}" type="number" value="\${g.price_adult_oneway??55}" placeholder="55">
              <input id="gs-co-\${i}" type="number" value="\${g.price_child_oneway??25}" placeholder="25">
            </div>
          </div>
        </div>
        <div>
          <label>Return-leg only $ — adult / child</label>
          <div style="display:flex;gap:6px">
            <input id="gs-af-\${i}" type="number" value="\${g.price_adult_oneway_from??35}" placeholder="35">
            <input id="gs-cf-\${i}" type="number" value="\${g.price_child_oneway_from??15}" placeholder="15">
          </div>
        </div>
        <button class="primary" style="margin-top:10px" onclick="saveGame('\${encodeURIComponent(g.game)}',\${i})">Save \${esc(g.game.slice(0,30))}</button>
        <div id="gs-msg-\${i}" style="min-height:16px;font-size:12px;margin-top:6px"></div>
      </div>\`).join('');
  } catch(e){ $('g-list').innerHTML = '<div class="err">'+esc(e.message)+'</div>'; }
}

async function saveGame(gameEnc, i){
  const msg = $('gs-msg-'+i);
  msg.textContent = 'Saving…'; msg.style.color='#666';
  try {
    const payload = {
      game: decodeURIComponent(gameEnc),
      capacity: parseInt($('gs-cap-'+i).value)||60,
      fare_mode: $('gs-fm-'+i).value,
      price_adult_return: parseInt($('gs-ar-'+i).value)||90,
      price_child_return: parseInt($('gs-cr-'+i).value)||40,
      price_adult_oneway: parseInt($('gs-ao-'+i).value)||55,
      price_child_oneway: parseInt($('gs-co-'+i).value)||25,
      price_adult_oneway_from: parseInt($('gs-af-'+i).value)||35,
      price_child_oneway_from: parseInt($('gs-cf-'+i).value)||15,
    };
    await api('/api/game-settings', {method:'POST', body:JSON.stringify(payload)});
    msg.textContent = 'Saved ✓'; msg.style.color='#060';
    setTimeout(()=>{ msg.textContent=''; }, 2500);
  } catch(e){ msg.textContent = 'Failed: '+e.message; msg.style.color='#a00'; }
}

async function toggleActive(gameEnc, active){
  try {
    await api('/api/game-settings', {method:'POST', body:JSON.stringify({game: decodeURIComponent(gameEnc), active: !!active})});
    loadGameSettings();
  } catch(e){ alert(e.message); }
}

// Bootstrap
if (KEY) { $('adminwho').textContent='Admin logged in'; $('key').value=KEY; init(); }
else { tab('key'); }
</script></body></html>`;

function html(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Cache-Control": "no-store" },
  });
}


// ─── v9.1 admin-endpoint handlers (ported from bulldogs) ───────────────
async function handleBackfillTokens(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  // Find bookings without cancel_token and generate one
  const rows = await env.DB.prepare(`SELECT id FROM bookings WHERE cancel_token IS NULL OR cancel_token = ''`).all();
  const missing = rows.results || [];
  let updated = 0;
  for (const row of missing) {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2,'0')).join('').slice(0,10);
    await env.DB.prepare(`UPDATE bookings SET cancel_token=? WHERE id=?`).bind(token, row.id).run();
    updated++;
  }
  return jsonR({ ok: true, updated, total_missing: missing.length });
}

async function handleSendReminders(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  const game = body.game;
  if (!game) return errR("game required");
  const rows = await env.DB.prepare(
    `SELECT id, name, email, fare, price, game, cancel_token FROM bookings WHERE game = ? AND email != '' AND email IS NOT NULL`
  ).bind(game).all();
  const bookings = rows.results || [];
  let sent = 0, failed = 0;
  for (const b of bookings) {
    const r = await sendBookingEmail(env, { ...b, pay: 'cash' }, b.cancel_token, null);
    if (r && r.ok) sent++; else failed++;
  }
  return jsonR({ ok: true, sent, failed, total: bookings.length });
}

async function handleBroadcast(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  const { game, subject, message } = body;
  if (!game || !message) return errR("game and message required");
  if (!env.RESEND_API_KEY) return errR("Email broadcast unavailable (no RESEND_API_KEY)", 503);
  const rows = await env.DB.prepare(
    `SELECT DISTINCT email, name FROM bookings WHERE game = ? AND email != '' AND email IS NOT NULL`
  ).bind(game).all();
  const recips = rows.results || [];
  let sent = 0, failed = 0;
  for (const r of recips) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Bomber Boat <bookings@bomberboat.com.au>',
          to: [r.email],
          reply_to: 'pgallivan@outlook.com',
          subject: subject || `Bomber Boat — update for ${game}`,
          html: `<p>Hi ${r.name || 'there'},</p><p>${String(message).replace(/\n/g,'<br>')}</p><p>— Paddy, Bomber Boat</p>`,
        }),
      });
      if (resp.ok) sent++; else failed++;
    } catch (e) { failed++; }
  }
  return jsonR({ ok: true, sent, failed, total: recips.length, channel: 'email' });
}
// ────────────────────────────────────────────────────────────────────────


// ─── v9.3 Boats (fleet) management ─────────────────────────────
async function handleListBoats(env) {
  const rows = await env.DB.prepare(`SELECT id, name, capacity, emoji, notes, active FROM boats ORDER BY id ASC`).all();
  return jsonR({ boats: rows.results || [] });
}
async function handleUpsertBoat(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  const { id, name, capacity, emoji, notes, active } = body;
  if (id) {
    await env.DB.prepare(`UPDATE boats SET
        name=COALESCE(?,name), capacity=COALESCE(?,capacity),
        emoji=COALESCE(?,emoji), notes=COALESCE(?,notes),
        active=COALESCE(?,active)
      WHERE id=?`)
      .bind(name || null, capacity || null, emoji || null, notes ?? null,
        (active === undefined ? null : (active ? 1 : 0)), id).run();
    return jsonR({ ok: true, id });
  } else {
    if (!name) return errR("Boat name required");
    const res = await env.DB.prepare(`INSERT INTO boats (name, capacity, emoji, notes) VALUES (?, ?, ?, ?) RETURNING *`)
      .bind(name, capacity || 60, emoji || '⛵', notes || '').first();
    return jsonR({ ok: true, boat: res });
  }
}
async function handleDeleteBoat(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('id'));
  if (!id) return errR("id required");
  // Null-out boat_id on any game using this boat
  await env.DB.prepare(`UPDATE game_settings SET boat_id=NULL WHERE boat_id=?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM boats WHERE id=?`).bind(id).run();
  return jsonR({ ok: true });
}
// ───────────────────────────────────────────────────────────────


// ─── v9.4 — compat endpoints for bulldogs-style admin ─────────
async function handleListWaitlist(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const url = new URL(request.url);
  const game = url.searchParams.get('game');
  const rows = game
    ? await env.DB.prepare(`SELECT * FROM waitlist WHERE game = ? ORDER BY created_at DESC`).bind(game).all()
    : await env.DB.prepare(`SELECT * FROM waitlist ORDER BY created_at DESC`).all();
  return jsonR({ waitlist: rows.results || [] });
}
async function handleDeleteWaitlist(request, env, id) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  await env.DB.prepare(`DELETE FROM waitlist WHERE id = ?`).bind(id).run();
  return jsonR({ ok: true });
}
async function handleDeleteBooking(request, env, id) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  await env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(id).run();
  return jsonR({ ok: true });
}
async function handlePatchBooking(request, env, id) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const vals = [];
  for (const k of ['name','phone','email','fare','pass_type','pay','price','notes','game']) {
    if (body[k] !== undefined) { fields.push(`${k}=?`); vals.push(body[k]); }
  }
  if (!fields.length) return errR("Nothing to update");
  vals.push(id);
  await env.DB.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
  const row = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(id).first();
  return jsonR({ ok: true, booking: row });
}
async function handleBookingsCount(request, env) {
  // v9.19 — public read access (counts only, no PII) so SOLD-OUT badges work on /
  const rows = await env.DB.prepare(`SELECT game, COUNT(*) as count FROM bookings GROUP BY game`).all();
  const counts = {};
  for (const r of rows.results || []) counts[r.game] = r.count;
  const total = Object.values(counts).reduce((a,b) => a+b, 0);
  return jsonR({ total, per_game: counts });
}
// ──────────────────────────────────────────────────────────────


// ─── v9.6 Multi-boat per game ─────────────────────────
async function handleListGameBoats(request, env) {
  const url = new URL(request.url);
  const game = url.searchParams.get('game');
  const rows = game
    ? await env.DB.prepare(`SELECT gb.*, b.name, b.capacity, b.emoji FROM game_boats gb LEFT JOIN boats b ON b.id=gb.boat_id WHERE gb.game=?`).bind(game).all()
    : await env.DB.prepare(`SELECT gb.*, b.name, b.capacity, b.emoji FROM game_boats gb LEFT JOIN boats b ON b.id=gb.boat_id`).all();
  return jsonR({ assignments: rows.results || [] });
}
async function handleAssignBoat(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const body = await request.json().catch(() => ({}));
  const { game, boat_id } = body;
  if (!game || !boat_id) return errR("game and boat_id required");
  await env.DB.prepare(`INSERT OR IGNORE INTO game_boats (game, boat_id) VALUES (?, ?)`).bind(game, boat_id).run();
  // Recompute game capacity = sum of all assigned boat capacities
  const capRow = await env.DB.prepare(`SELECT COALESCE(SUM(b.capacity), 60) AS total FROM game_boats gb LEFT JOIN boats b ON b.id=gb.boat_id WHERE gb.game=?`).bind(game).first();
  await env.DB.prepare(`UPDATE game_settings SET capacity=? WHERE game=?`).bind(capRow?.total || 60, game).run();
  return jsonR({ ok: true, game, boat_id, capacity: capRow?.total });
}
async function handleUnassignBoat(request, env) {
  const auth = requireApiKey(request, env);
  if (auth) return auth;
  const url = new URL(request.url);
  const game = url.searchParams.get('game');
  const boat_id = parseInt(url.searchParams.get('boat_id'));
  if (!game || !boat_id) return errR("game and boat_id required");
  await env.DB.prepare(`DELETE FROM game_boats WHERE game=? AND boat_id=?`).bind(game, boat_id).run();
  const capRow = await env.DB.prepare(`SELECT COALESCE(SUM(b.capacity), 60) AS total FROM game_boats gb LEFT JOIN boats b ON b.id=gb.boat_id WHERE gb.game=?`).bind(game).first();
  await env.DB.prepare(`UPDATE game_settings SET capacity=? WHERE game=?`).bind(capRow?.total || 60, game).run();
  return jsonR({ ok: true, capacity: capRow?.total });
}
// ─────────────────────────────────────────────────────


// ─── v9.11: Captain QR scan → one-tap board ───────────────
async function handleBoardScan(request, env) {
  const url = new URL(request.url);
  const id = parseInt(url.searchParams.get('b'));
  const token = url.searchParams.get('t');
  const leg = url.searchParams.get('leg'); // 'out' or 'back' on POST
  if (!id || !token) return new Response('Missing b or t parameter', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  let b = await env.DB.prepare(`SELECT id, name, email, game, fare, pass_type, price, checked_in_out, checked_in_back, cancel_token FROM bookings WHERE id = ?`).bind(id).first();
  if (!b) return new Response('Booking not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
  if (b.cancel_token !== token) return new Response('Invalid token', { status: 403, headers: { 'Content-Type': 'text/plain' } });

  if (request.method === 'POST' && leg) {
    const col = leg === 'back' ? 'checked_in_back' : 'checked_in_out';
    await env.DB.prepare(`UPDATE bookings SET ${col} = datetime('now'), checked_in = COALESCE(checked_in, datetime('now')), checked_in_by = 'QR scan' WHERE id = ?`).bind(id).run();
    if (leg === 'back') b.checked_in_back = new Date().toISOString();
    else b.checked_in_out = new Date().toISOString();
  }

  const fareLabel = b.fare === 'return' ? 'Return (both ways)' : (b.fare === 'oneway_from' ? 'Return leg only' : 'One-way to game');
  // Determine which buttons to show based on fare type
  const showOut  = (b.fare === 'return' || b.fare === 'oneway_to');
  const showBack = (b.fare === 'return' || b.fare === 'oneway_from');

  const btnOut = showOut
    ? (b.checked_in_out
        ? '<div class="boarded">✓ OUTBOUND BOARDED</div>'
        : `<form method="POST" action="?b=${id}&t=${token}&leg=out"><button type="submit" class="btn">→ BOARD OUTBOUND</button></form>`)
    : '';
  const btnBack = showBack
    ? (b.checked_in_back
        ? '<div class="boarded">✓ RETURN BOARDED</div>'
        : `<form method="POST" action="?b=${id}&t=${token}&leg=back"><button type="submit" class="btn btn-back">← BOARD RETURN</button></form>`)
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bomber Boat — Board #${b.id}</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,Helvetica,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{max-width:420px;width:100%;background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:18px;overflow:hidden}
  .head{background:#CC2031;padding:24px;text-align:center}
  .head h1{margin:0;font-size:22px;letter-spacing:1px}
  .head .sub{font-size:13px;opacity:.85;margin-top:4px}
  .body{padding:20px}
  .row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.08);font-size:14px}
  .row:last-child{border-bottom:none}
  .row b{color:#aaa;font-weight:500}
  .btn{display:block;width:100%;background:#22c55e;color:#000;border:none;border-radius:14px;padding:18px;font-size:20px;font-weight:700;letter-spacing:2px;cursor:pointer;margin-top:12px;text-transform:uppercase}
  .btn-back{background:#7dd3fc;color:#000}
  .boarded{background:rgba(34,197,94,0.15);border:2px solid #22c55e;border-radius:14px;padding:18px;text-align:center;margin-top:12px;color:#22c55e;font-size:18px;font-weight:700;letter-spacing:2px}
  form{margin:0}
</style></head><body>
<div class="card">
  <div class="head"><h1>BOMBER BOAT</h1><div class="sub">Booking #${b.id} · ${fareLabel}</div></div>
  <div class="body">
    <div class="row"><b>Name</b><span>${(b.name || b.email || '—').replace(/[<>"&]/g,'')}</span></div>
    <div class="row"><b>Game</b><span style="text-align:right;font-size:12px;max-width:60%">${(b.game||'').replace(/[<>"&]/g,'')}</span></div>
    <div class="row"><b>Type</b><span>${b.pass_type === 'child' ? 'Child / U18' : 'Adult'}</span></div>
    <div class="row"><b>Price</b><span>$${b.price}</span></div>
    ${btnOut}
    ${btnBack}
  </div>
</div>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
// ─────────────────────────────────────────────────────


// ── /api/interest — public interest registration for non-Essendon Marvel/MCG games ──
async function ensureInterestTable(env) {
  // v9.18: ensure fare_type column exists for tables created before fare_type was added
  try { await env.DB.exec(`ALTER TABLE interest ADD COLUMN fare_type TEXT DEFAULT 'return'`); } catch(e) { /* column already exists */ }
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS interest (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT NOT NULL, phone TEXT, venue TEXT, game_text TEXT, fare_type TEXT DEFAULT 'return', party_size INTEGER DEFAULT 1, notes TEXT, contacted INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
}
async function handleInterestCreate(request, env) {
  try {
    await ensureInterestTable(env);
    const body = await request.json();
    const name = (body.name || "").toString().trim().slice(0, 80);
    const email = (body.email || "").toString().trim().toLowerCase().slice(0, 120);
    const phone = (body.phone || "").toString().trim().slice(0, 30);
    const venue = (body.venue || "").toString().trim().slice(0, 30);
    const game_text = (body.game_text || body.game || "").toString().trim().slice(0, 200);
    const party_size = Math.max(1, Math.min(50, parseInt(body.party_size || body.adults || 1) || 1));
    const notes = (body.notes || "").toString().trim().slice(0, 500);
    const ft = (body.fare_type || "return").toString().trim();
    const fare_type = ["return","oneway_to","oneway_from"].includes(ft) ? ft : "return";
    if (!email || !email.includes("@")) return errR("Valid email required", 400);
    if (!venue) return errR("Venue required", 400);
    if (!game_text) return errR("Which game required", 400);
    const ins = await env.DB.prepare(
      `INSERT INTO interest (name,email,phone,venue,game_text,fare_type,party_size,notes) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(name, email, phone, venue, game_text, fare_type, party_size, notes).run();
    const id = ins.meta?.last_row_id;
    // Confirmation email via Resend
    if (env.RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Bomber Boat <bookings@bomberboat.com.au>",
            to: [email],
            reply_to: "hello@bomberboat.com.au",
            subject: `You're on the list — ${venue}: ${game_text}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#0a1929"><h2 style="color:#CC2031;margin:0 0 8px">⛵ You're on the list</h2><p>Thanks ${name || "there"} — we've registered your interest for:</p><div style="background:#f7f9fc;border-left:4px solid #CC2031;padding:14px 18px;margin:14px 0"><div><strong>Venue:</strong> ${venue}</div><div><strong>Game/Event:</strong> ${game_text}</div><div><strong>Direction:</strong> ${fare_type === "return" ? "Return (both ways)" : (fare_type === "oneway_to" ? "One-way TO the game" : "One-way FROM the game")}</div><div><strong>Group size:</strong> ${party_size}</div></div><p>If we get enough interest for this game, we'll charter a boat and email you a booking link before anyone else.</p><p>Cheers,<br/><strong>The Bomber Boat crew</strong><br/><a href="mailto:hello@bomberboat.com.au">hello@bomberboat.com.au</a></p></div>`
          })
        });
      } catch (e) { /* don't block on email errors */ }
    }
    return jsonR({ ok: true, id });
  } catch (e) {
    return errR("Interest registration failed: " + e.message, 500);
  }
}
async function handleInterestList(request, env) {
  const auth = requireAdmin(request, env); if (auth) return auth;
  await ensureInterestTable(env);
  const rows = await env.DB.prepare(`SELECT * FROM interest ORDER BY created_at DESC LIMIT 1000`).all();
  return jsonR({ interest: rows.results || [] });
}
async function handleInterestDelete(request, env, id) {
  const auth = requireAdmin(request, env); if (auth) return auth;
  await env.DB.prepare(`DELETE FROM interest WHERE id=?`).bind(id).run();
  return jsonR({ ok: true });
}
async function handleInterestEmail(request, env) {
  const auth = requireAdmin(request, env); if (auth) return auth;
  if (!env.RESEND_API_KEY) return errR("RESEND_API_KEY missing", 500);
  const body = await request.json();
  const ids = body.ids || [];
  const subject = body.subject || "Update from Bomber Boat";
  const message = body.message || "";
  if (!ids.length || !message) return errR("ids[] and message required", 400);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT id, name, email FROM interest WHERE id IN (${placeholders})`).bind(...ids).all();
  let sent = 0;
  for (const r of (rows.results || [])) {
    try {
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#0a1929"><p>Hi ${r.name || "there"},</p>${message.split("\n").map(p => `<p>${p}</p>`).join("")}<p>Cheers,<br/><strong>The Bomber Boat crew</strong></p></div>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Bomber Boat <bookings@bomberboat.com.au>", to: [r.email], reply_to: "hello@bomberboat.com.au", subject, html })
      });
      await env.DB.prepare(`UPDATE interest SET contacted = contacted + 1 WHERE id = ?`).bind(r.id).run();
      sent++;
    } catch (e) { /* skip */ }
  }
  return jsonR({ ok: true, sent, total: ids.length });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/ping") return jsonR({ ok: true, ts: new Date().toISOString() });
    if (path === "/health") return jsonR({ status: "healthy", ts: new Date().toISOString() });
    if (path === "/info")
      return jsonR({
        name: "Bomber Boat",
        depart: "Riviera, Maribyrnong",
        arrive: "Marvel Stadium",
        boardTime: "10:50am",
        departTime: "11:00am",
        arriveTime: "12:00pm",
        pricing: { adult_return: 35, adult_oneway: 55, child_return: 15, child_oneway: 25 },
        included: ["Free drink on arrival", "Complimentary finger food on board", "Cheap bar available during trip"],
        payment: {
          advance: "Card via Stripe on bomberboat.com.au",
          walkup_return_leg: "Cash preferred; card available on board",
          one_way_return_leg: 35,
        },
        operator: "Yarra River Cruises",
      });

    // Friendly login redirects (v9.16)
    const REDIR = (login) => Response.redirect("https://www.bomberboat.com.au/bomberboat-admin?login=" + login, 302);
    if (path === "/admin" || path === "/admin/")     return REDIR("admin");
    if (path === "/captain" || path === "/captain/") return REDIR("captain");
    if (path === "/staff" || path === "/staff/")     return REDIR("staff");
    // Legacy hosted pages (kept for /checkin)
    if (path === "/checkin") return html(CHECKIN_HTML);
    if (path === "/admin/pin" || path === "/admin/pin/") return html(ADMIN_HTML);

    if (path === "/api/schedule") return handleSchedule(env);
    // v9.1: endpoints ported from bulldogs-boat-api to support bulldogs-style admin
    if (path === "/api/board" || path === "/api/board/") return handleRoster(request, env);
    if (path === "/api/scan" || path === "/api/scan/") return handleBoardScan(request, env);
    if (path === "/api/boats" && method === "GET") return handleListBoats(env);
    if (path === "/api/boats" && method === "POST") return handleUpsertBoat(request, env);
    if (path === "/api/boats" && method === "DELETE") return handleDeleteBoat(request, env);
    // v9.6 multi-boat assignments
    if (path === "/api/game-boats" && method === "GET") return handleListGameBoats(request, env);
    if (path === "/api/game-boats" && method === "POST") return handleAssignBoat(request, env);
    if (path === "/api/game-boats" && method === "DELETE") return handleUnassignBoat(request, env);
    if (path === "/api/backfill-tokens" && method === "POST") return handleBackfillTokens(request, env);
    if (path === "/api/reminders/send" && method === "POST") return handleSendReminders(request, env);
    if (path === "/api/broadcast" && method === "POST") return handleBroadcast(request, env);
    // v9.4 compat for bulldogs-style admin
    if (path === "/api/waitlist" && method === "GET") return handleListWaitlist(request, env);
    if (path.startsWith("/api/waitlist/") && method === "DELETE") return handleDeleteWaitlist(request, env, parseInt(path.split("/").pop()));
    if (path === "/api/bookings/count" && method === "GET") return handleBookingsCount(request, env);
    if (path.startsWith("/api/bookings/") && method === "DELETE") {
      const id = parseInt(path.split("/").pop());
      if (id) return handleDeleteBooking(request, env, id);
    }
    if (path.startsWith("/api/bookings/") && method === "PATCH") {
      const id = parseInt(path.split("/").pop());
      if (id) return handlePatchBooking(request, env, id);
    }
    if (path === "/api/games") {
      const counts = await env.DB.prepare(`SELECT game, COUNT(*) as count FROM bookings GROUP BY game`).all();
      const total = await env.DB.prepare(`SELECT COUNT(*) as count FROM bookings`).first();
      return jsonR({ total: total?.count || 0, games: counts.results || [] });
    }

    if (method === "POST" && (path === "/api/book" || path === "/api/bookings")) return handleBook(request, env);
    if (path === "/api/cancel") return handleCancel(url, env);
    if (path === "/api/waitlist" && method === "POST") return handleWaitlist(request, env);
    if (path === "/api/game-settings") return handleGameSettings(request, env);
    if (path === "/api/bookings" && method === "GET") return handleBookingsList(request, env);
    if (path === "/api/bookings-admin") return handleBookingsList(request, env);
    if (path === "/api/waitlist-admin") return handleWaitlistAdmin(request, env);

    // v9.17: Register interest for non-Essendon games (Marvel, MCG, etc.)
    if (path === "/api/interest" && method === "POST") return handleInterestCreate(request, env);
    if (path === "/api/interest" && method === "GET")  return handleInterestList(request, env);
    if (path.startsWith("/api/interest/") && method === "DELETE") {
      const id = parseInt(path.split("/").pop());
      if (id) return handleInterestDelete(request, env, id);
    }
    if (path === "/api/interest/email" && method === "POST") return handleInterestEmail(request, env);

    // Captain PIN
    if (path === "/api/captain-pin") return handleCaptainPin(request, env);
    if (path === "/api/captain-login" && method === "POST") return handleCaptainLogin(request, env);
    if (path === "/api/admin-login" && method === "POST") return handleAdminLogin(request, env);

    if (path === "/api/checkin" && method === "POST") return handleCheckin(request, env);
    if (path === "/api/roster" && method === "GET") return handleRoster(request, env);
    if (path === "/falkor/upcoming") return handleFalkorFeed(env);

    return jsonR({
      error: "Not found",
      path,
      routes: [
        "/ping", "/health", "/info",
        "/checkin", "/admin/pin",
        "/api/schedule", "/api/games",
        "/api/book", "/api/bookings", "/api/cancel",
        "/api/waitlist",
        "/api/game-settings", "/api/bookings-admin", "/api/waitlist-admin",
        "/api/captain-pin", "/api/captain-login",
        "/api/checkin", "/api/roster",
        "/falkor/upcoming",
      ],
    }, 404);
  },
};