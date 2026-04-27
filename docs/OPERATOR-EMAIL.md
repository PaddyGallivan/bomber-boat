# Bomber Boat — Yarra River Cruises operating terms

**Source:** Email from **Con Sarrou, Events Manager · Yarra River Cruises** (`enquiries@yarrarivercruises.com.au`), Mon 20 Apr 2026 ~12pm, in reply to Paddy's 18 Apr.
**Saved:** 22 Apr 2026
**Authoritative:** this file supersedes any earlier pricing/margin notes.

---

## 1. Fares (per passenger)

| | Adult | Child / U18 | Notes |
|---|---|---|---|
| **Return** (both ways, main fare) | **$55** | **$25** | Includes free drink on arrival + complimentary finger food on board |
| **One-way / return leg only** | **$35** | **$15** | For passengers who only need the return leg from Marvel; can be paid **cash** on the day |
| Walk-up on the day | **TBC — ask Con** | **TBC — ask Con** | Open question from Con: "If there is room, what do we charge for walk-ups?" |

> D1 `game_settings` has been updated (22 Apr 2026) to match these fares for all 8 games (R7–R24).
> Adult one-way / child one-way values for walk-ups inherit the same $35 / $15 until Con confirms otherwise.

## 2. What's included in the return fare

- **Free drink on arrival** (at boarding — Cafe Riviera, Maribyrnong)
- **Complimentary finger food** on board
- Cheap bar stays open during the trip (customer pays for additional drinks)

## 3. Commercials (Paddy's side)

- **Paddy's margin: $10 per adult** from each sold return seat.
- **Food allowance: $5 per passenger** — Con allocates this amount for Paddy to organise onboard food. Hot dogs / cheerios ("Saveloys" / savs) is the suggested cheap & easy option.
  - Net to Paddy per adult = $10 margin – catering costs supplied above the $5pp allowance.

## 4. Payments

- **Stripe** via the public site for advance return bookings (card).
- **Cash preferred on the return leg** — walk-ups / one-way returnees at the Marvel dock pay cash if possible.
- **Card facilities are available on the boat** if a passenger can't pay cash.
- Cash floats / change bag: Paddy to bring enough for the day.

## 5. Operational — day of game

- **Guest list required onboard** to mark off names as passengers board.
- Worker endpoints `/api/checkin` + `/api/roster` let staff tick names off on a phone.
- Mobile check-in is built into `bomberboat-admin.html` (staff role) — one button per passenger.
- Fallback: export the roster as CSV from admin before leaving, in case of flaky wifi at the dock.

## 6. Outstanding questions to go back to Con on

1. **Walk-up pricing** — flat rate, or same as one-way ($35 / $15)?
2. Does the **free drink on arrival** apply to U18s as well? (Assume soft drink for U18s.)
3. Timing cut-off for **final passenger count** — when does Con need numbers locked in?
4. Any discount tier for **groups / families**?

---

## Con's verbatim wording (for reference)

> Hi Paddy,
>
> Pricing is $55 Adults, $25 children. Free drink on arrival.
>
> You take $10 per adult. We can allocate $5pp for food that goes to you to organise. Hot dog Saveloys is another easy option, and relatively cheap.
>
> Return $35 for return passengers (can pay cash). If there is room, what do we charge for walk-ups?
>
> Cash preferred on return leg but have card facilities on the boat. You will need a guests list to mark off names.
>
> Kind Regards,
> Con
>
> Con Sarrou | Events Manager
> Yarra River Cruises
