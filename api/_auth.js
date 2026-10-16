// Codes d'accès autorisés : variable ACCESS_CODES = "CODE1,CODE2" (un par testeur).
export function checkCode(req) {
  const codes = (process.env.ACCESS_CODES || '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
  const given = String(req.headers['x-access-code'] || '').trim().toUpperCase();
  return given && codes.includes(given) ? given : null;
}
