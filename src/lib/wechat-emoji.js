/**
 * The WeChat emoticon set — the 114 proprietary `[Smile]` / `[Doge]` stickers
 * WeChat ships alongside Unicode emoji, catalogued at
 * https://emojipedia.org/wechat (artwork: WeChat 8.0.2 for iOS).
 *
 * These are built-in emotes, NOT class uploads: the art is bundled under
 * `static/wechat/` rather than living in R2 + the `custom_emoji` table. But
 * they ride the SAME `[ce:shortcode]` token as an upload does, so every
 * surface that already renders a custom emote inline — bubbles, reactions,
 * the compose box, profile bios, notification previews — renders these with
 * no change at all. The one thing that makes that work is seeding them into
 * the shared shortcode→url map in `custom-emoji-store.js`; see the merge
 * there for why built-ins are the BASE layer and uploads win a collision.
 *
 * Shortcodes are prefixed `wc_` so they can never collide with something an
 * instructor uploads, and so `:wc_` in the compose box lists the whole set.
 * Source art is normalised to 128x128 webp (the originals are a mix of
 * 64/80/97/128 px PNGs) so an inline emote gets one predictable box.
 */

// [shortcode-without-prefix, display name] — the prefix is applied below so
// this table stays readable and the `wc_` convention can't drift per entry.
const RAW = [
	['aaagh', 'Aaagh!'],
	['angry', 'Angry'],
	['awesome', 'Awesome'],
	['awkward', 'Awkward'],
	['bah_r', 'Bah！R'],
	['bah_l', 'Bah！L'],
	['beckon', 'Beckon'],
	['beer', 'Beer'],
	['blessing', 'Blessing'],
	['blush', 'Blush'],
	['bomb', 'Bomb'],
	['boring', 'Boring'],
	['broken', 'Broken'],
	['brokenheart', 'BrokenHeart'],
	['bye', 'Bye'],
	['cake', 'Cake'],
	['chuckle', 'Chuckle'],
	['clap', 'Clap'],
	['cleaver', 'Cleaver'],
	['coffee', 'Coffee'],
	['commando', 'Commando'],
	['concerned', 'Concerned'],
	['coolguy', 'CoolGuy'],
	['cry', 'Cry'],
	['determined', 'Determined'],
	['dizzy', 'Dizzy'],
	['doge', 'Doge'],
	['drool', 'Drool'],
	['drowsy', 'Drowsy'],
	['duh', 'Duh'],
	['emm', 'Emm'],
	['facepalm', 'Facepalm'],
	['fireworks', 'Fireworks'],
	['fist', 'Fist'],
	['flushed', 'Flushed'],
	['frown', 'Frown'],
	['gift', 'Gift'],
	['goforit', 'GoForIt'],
	['grimace', 'Grimace'],
	['grin', 'Grin'],
	['hammer', 'Hammer'],
	['happy', 'Happy'],
	['heart', 'Heart'],
	['hey', 'Hey'],
	['hug', 'Hug'],
	['hurt', 'Hurt'],
	['joyful', 'Joyful'],
	['keepfighting', 'KeepFighting'],
	['kiss', 'Kiss'],
	['laugh', 'Laugh'],
	['let_down', 'Let Down'],
	['letmesee', 'LetMeSee'],
	['lips', 'Lips'],
	['lol', 'Lol'],
	['moon', 'Moon'],
	['mybad', 'MyBad'],
	['noprob', 'NoProb'],
	['nosepick', 'NosePick'],
	['ok', 'OK'],
	['omg', 'OMG'],
	['onlooker', 'Onlooker'],
	['packet', 'Packet'],
	['panic', 'Panic'],
	['party', 'Party'],
	['peace', 'Peace'],
	['pig', 'Pig'],
	['pooh_pooh', 'Pooh-pooh'],
	['poop', 'Poop'],
	['puke', 'Puke'],
	['respect', 'Respect'],
	['rose', 'Rose'],
	['salute', 'Salute'],
	['scold', 'Scold'],
	['scowl', 'Scowl'],
	['scream', 'Scream'],
	['shake', 'Shake'],
	['shhh', 'Shhh'],
	['shocked', 'Shocked'],
	['shrunken', 'Shrunken'],
	['shy', 'Shy'],
	['sick', 'Sick'],
	['sigh', 'Sigh'],
	['silent', 'Silent'],
	['skull', 'Skull'],
	['sleep', 'Sleep'],
	['slight', 'Slight'],
	['sly', 'Sly'],
	['smart', 'Smart'],
	['smile', 'Smile'],
	['smirk', 'Smirk'],
	['smug', 'Smug'],
	['sob', 'Sob'],
	['speechless', 'Speechless'],
	['sun', 'Sun'],
	['surprise', 'Surprise'],
	['sweat', 'Sweat'],
	['sweats', 'Sweats'],
	['tearingup', 'TearingUp'],
	['terror', 'Terror'],
	['thumbsdown', 'ThumbsDown'],
	['thumbsup', 'ThumbsUp'],
	['toasted', 'Toasted'],
	['tongue', 'Tongue'],
	['tremble', 'Tremble'],
	['trick', 'Trick'],
	['twirl', 'Twirl'],
	['watermelon', 'Watermelon'],
	['waddle', 'Waddle'],
	['whimper', 'Whimper'],
	['wilt', 'Wilt'],
	['worship', 'Worship'],
	['wow', 'Wow'],
	['yawn', 'Yawn'],
	['yeah', 'Yeah!'],
];

export const WECHAT_PREFIX = 'wc_';

/** @type {{ shortcode: string, name: string, url: string }[]} */
export const WECHAT_EMOJI = RAW.map(([slug, name]) => ({
	shortcode: WECHAT_PREFIX + slug,
	name,
	url: `/wechat/${WECHAT_PREFIX}${slug}.webp`
}));

/** shortcode → { shortcode, name, url } */
export const WECHAT_BY_SHORTCODE = Object.fromEntries(
	WECHAT_EMOJI.map((e) => [e.shortcode, e])
);

/** True for any shortcode belonging to the built-in set (i.e. not deletable). */
export function isWechatShortcode(shortcode) {
	return Object.hasOwn(WECHAT_BY_SHORTCODE, shortcode);
}
