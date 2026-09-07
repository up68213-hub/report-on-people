/**
 * Заготовка для коробочного Bitrix24.
 *
 * После получения адреса портала этот адаптер будет включён через
 * AUTH_MODE=bitrix. Точка запуска принимает OAuth-контекст Bitrix24,
 * сервер проверяет его вызовом user.current и выдаёт короткую внутреннюю
 * сессию. Остальной API использует request.currentUser и не зависит от
 * конкретного поставщика идентификации.
 */
export async function verifyBitrixLaunchContext() {
  throw new Error('Bitrix24 adapter is not configured');
}
