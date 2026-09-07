Attribute VB_Name = "Otchet"
Option Explicit

' ==========================================================
'  Кнопка "Записать данные" (Югорская долина) — v8.5
'  Версия, устойчивая к кодировке файла: Windows и macOS
'
'  ЗАЧЕМ ЭТА ВЕРСИЯ
'  Excel для Windows и Excel для Mac читают файл .bas в разных
'  однобайтовых кодировках. Из-за этого кириллица в коде
'  превращалась в мусор: имена листов вида "Форма ввода"
'  становились "”орма ввода", и макрос падал с ошибкой
'  Subscript out of range, а искажённые имена переменных давали
'  Invalid character.
'
'  Здесь этой проблемы нет:
'  1) все имена переменных и процедур — латиницей, поэтому
'     перекодировка не может сделать их недопустимыми;
'  2) имена листов, таблиц и столбцов хранятся как Unicode-коды
'     (строки вида "424 43E 440"), состоящие только из цифр
'     и латинских букв. Функция RU() собирает из них настоящий
'     текст через ChrW уже во время работы макроса.
'  Кириллица осталась только в текстах сообщений. Если файл всё
'  же откроют не в той кодировке, сообщения станут нечитаемыми,
'  но САМ МАКРОС ПРОДОЛЖИТ РАБОТАТЬ ПРАВИЛЬНО.
'
'  ВАЖНО: точка входа теперь называется ZapisatOtchet.
'  После установки модуля назначьте её кнопке на листе:
'  правой кнопкой по кнопке -> "Назначить макрос" -> ZapisatOtchet
'
'  НОВОЕ в v8.5: по пятницам оценка качества обязательна —
'  все 5 критериев должны быть заполнены по каждому подрядчику.
'  Исключения: вид работ "Собственные силы", строки без подрядчика,
'  строки, где решение содержит "не выбран" (подрядчика нет),
'  и подрядчики с нулевой явкой за последние WEEK_DAYS дней —
'  если людей не было всю неделю, оценивать нечего.
'  Проверяется день недели даты отчёта из C4, а не системная дата.
'  Отключается константой FRIDAY_QUALITY = False.
'
'  Из v8.3: после успешной записи книга сохраняется
'  автоматически. Отключается константой AUTOSAVE = False.
'  Если файл открыт только для чтения или ещё ни разу не сохранялся,
'  макрос не падает, а пишет об этом в итоговом окне.
'
'  Из v8.2: если в строке указана причина
'  "фронт и материалы есть, нет людей", столбец "Решение"
'  становится обязательным — запись без него не проходит.
'  Список таких причин лежит в константе N_REASON_DEC,
'  несколько значений разделяются знаком "|".
'
'  Логика работы не изменилась:
'  - дата берётся из C4 листа "Форма ввода";
'  - причина обязательна только при недоборе людей (факт < плана),
'    для вида работ "Собственные силы" причина не требуется;
'  - оценка 0-5 считается формулой в столбце "Итоговая оценка",
'    макрос её только переносит;
'  - решение и выбранные факты по 5 критериям уходят в отчёт;
'  - дубли "дата+вид+детализация+подрядчик": Да — обновить,
'    Нет — полная отмена без очистки формы;
'  - поля формы очищаются только после успешной записи.
' ==========================================================

' Автосохранение книги после успешной записи.
' Поставьте False, если сохранять нужно вручную.
Private Const AUTOSAVE As Boolean = True

' По пятницам оценка качества обязательна по всем подрядчикам.
' Проверяется день недели ДАТЫ ОТЧЁТА из ячейки C4, а не системная дата.
' Поставьте False, чтобы отключить правило.
Private Const FRIDAY_QUALITY As Boolean = True

' Сколько последних дней смотреть на явку подрядчика.
' Если за это окно факт всегда был 0, оценивать нечего
' и пятничная проверка такую строку пропускает.
Private Const WEEK_DAYS As Long = 7

' --- имена объектов книги в виде Unicode-кодов ---
Private Const N_SH_FORM      As String = "424 43E 440 43C 430 20 432 432 43E 434 430"   ' Форма ввода
Private Const N_SH_DATA      As String = "424 43E 440 43C 430 20 43E 442 447 435 442 430"   ' Форма отчета
Private Const N_TBL_FORM     As String = "424 43E 440 43C 430 412 432 43E 434 430"   ' ФормаВвода
Private Const N_TBL_DATA     As String = "414 430 43D 43D 44B 435 5F 41A 43E 433 430 43B 44B 43C"   ' Данные_Когалым
Private Const N_OWN          As String = "421 43E 431 441 442 432 435 43D 43D 44B 435 20 441 438 43B 44B"   ' Собственные силы
' фронт и материалы есть, нет людей
Private Const N_REASON_DEC   As String = "444 440 43E 43D 442 20 438 20 43C 430 442 435 440 438 430 43B 44B 20 435 441 442 44C 2C 20 43D 435 442 20 43B " & _
    "44E 434 435 439"
Private Const N_DEC_NO_CONTR As String = "43D 435 20 432 44B 431 440 430 43D"   ' не выбран
Private Const N_F_WORK       As String = "412 438 434 20 440 430 431 43E 442 44B"   ' Вид работы
Private Const N_F_DETAIL     As String = "414 435 442 430 43B 438 437 430 446 438 44F"   ' Детализация
Private Const N_F_CONTR      As String = "41F 43E 434 440 44F 434 447 438 43A"   ' Подрядчик
Private Const N_F_PLAN       As String = "41F 43B 430 43D"   ' План
Private Const N_F_FACT       As String = "424 430 43A 442"   ' Факт
Private Const N_F_REASON     As String = "41F 440 438 447 438 43D 430"   ' Причина
Private Const N_F_SCORE      As String = "418 442 43E 433 43E 432 430 44F 20 43E 446 435 43D 43A 430"   ' Итоговая оценка
Private Const N_F_DECISION   As String = "420 435 448 435 43D 438 435"   ' Решение
Private Const N_F_C1         As String = "41A 430 447 435 441 442 432 43E"   ' Качество
Private Const N_F_C2         As String = "414 438 441 446 438 43F 43B 438 43D 430"   ' Дисциплина
Private Const N_F_C3         As String = "41A 43E 43B 2D 432 43E 20 43B 44E 434 435 439"   ' Кол-во людей
Private Const N_F_C4         As String = "412 44B 440 430 431 43E 442 43A 430"   ' Выработка
Private Const N_F_C5         As String = "427 438 441 442 43E 442 430"   ' Чистота
Private Const N_D_DATE       As String = "434 430 442 430 20 43E 442 447 435 442 430"   ' дата отчета
Private Const N_D_WORK       As String = "412 418 414 20 420 410 411 41E 422 42B"   ' ВИД РАБОТЫ
Private Const N_D_DETAIL     As String = "414 415 422 410 41B 418 417 410 426 418 42F"   ' ДЕТАЛИЗАЦИЯ
Private Const N_D_CONTR      As String = "41F 41E 414 420 42F 414 427 418 41A"   ' ПОДРЯДЧИК
Private Const N_D_SCORE      As String = "41E 426 415 41D 41A 410 20 41A 410 427 415 421 422 412 410"   ' ОЦЕНКА КАЧЕСТВА
Private Const N_D_PLAN       As String = "41F 41B 410 41D"   ' ПЛАН
Private Const N_D_FACT       As String = "424 410 41A 422"   ' ФАКТ
Private Const N_D_REASON     As String = "41F 420 418 427 418 41D 410"   ' ПРИЧИНА
Private Const N_D_DECISION   As String = "420 415 428 415 41D 418 415"   ' РЕШЕНИЕ
Private Const N_D_C1         As String = "41A 410 427 415 421 422 412 41E 20 420 410 411 41E 422"   ' КАЧЕСТВО РАБОТ
Private Const N_D_C2         As String = "414 418 421 426 418 41F 41B 418 41D 410"   ' ДИСЦИПЛИНА
Private Const N_D_C3         As String = "41A 41E 41B 2D 412 41E 20 41B 42E 414 415 419"   ' КОЛ-ВО ЛЮДЕЙ
Private Const N_D_C4         As String = "412 42B 420 410 411 41E 422 41A 410"   ' ВЫРАБОТКА
Private Const N_D_C5         As String = "427 418 421 422 41E 422 410"   ' ЧИСТОТА

' --- тексты сообщений в виде Unicode-кодов ---
' Таблица формы ввода пуста — заполнять нечего.
Private Const M_EMPTY_FORM  As String = "422 430 431 43B 438 446 430 20 444 43E 440 43C 44B 20 432 432 43E 434 430 20 43F 443 441 442 430 20 2014 20 " & _
    "437 430 43F 43E 43B 43D 44F 442 44C 20 43D 435 447 435 433 43E 2E"
Private Const M_T_NO_DATA   As String = "41D 435 442 20 434 430 43D 43D 44B 445"   ' Нет данных
Private Const M_NEED_DATE   As String = "412 432 435 434 438 442 435 20 434 430 442 443 20 432 20 44F 447 435 439 43A 443 20 43 34 2E"   ' Введите дату в ячейку C4.
Private Const M_T_NO_DATE   As String = "41D 435 442 20 434 430 442 44B"   ' Нет даты
' В таблице формы ввода не хватает обязательных столбцов.
Private Const M_BAD_FORM    As String = "412 20 442 430 431 43B 438 446 435 20 444 43E 440 43C 44B 20 432 432 43E 434 430 20 43D 435 20 445 432 430 442 " & _
    "430 435 442 20 43E 431 44F 437 430 442 435 43B 44C 43D 44B 445 20 441 442 43E 43B 431 446 43E 432 2E"
Private Const M_T_BAD_FORM  As String = "421 442 440 443 43A 442 443 440 430 20 444 43E 440 43C 44B"   ' Структура формы
' В таблице отчёта не хватает обязательных столбцов.
Private Const M_BAD_DATA    As String = "412 20 442 430 431 43B 438 446 435 20 43E 442 447 451 442 430 20 43D 435 20 445 432 430 442 430 435 442 20 43E " & _
    "431 44F 437 430 442 435 43B 44C 43D 44B 445 20 441 442 43E 43B 431 446 43E 432 2E"
Private Const M_T_BAD_DATA  As String = "421 442 440 443 43A 442 443 440 430 20 43E 442 447 451 442 430"   ' Структура отчёта
' Не найден столбец решения в форме ввода или в отчёте.
Private Const M_NO_DEC_1    As String = "41D 435 20 43D 430 439 434 435 43D 20 441 442 43E 43B 431 435 446 20 440 435 448 435 43D 438 44F 20 432 20 444 " & _
    "43E 440 43C 435 20 432 432 43E 434 430 20 438 43B 438 20 432 20 43E 442 447 451 442 435 2E"
' Решения переноситься не будут — проверьте версию файла.
Private Const M_NO_DEC_2    As String = "420 435 448 435 43D 438 44F 20 43F 435 440 435 43D 43E 441 438 442 44C 441 44F 20 43D 435 20 431 443 434 443 " & _
    "442 20 2014 20 43F 440 43E 432 435 440 44C 442 435 20 432 435 440 441 438 44E 20 444 430 439 43B 430 2E"
Private Const M_T_NO_DEC    As String = "41D 435 442 20 441 442 43E 43B 431 446 430 20 440 435 448 435 43D 438 44F"   ' Нет столбца решения
Private Const M_NOTHING_1   As String = "41D 438 447 435 433 43E 20 43D 435 20 437 430 43F 438 441 430 43D 43E 2E"   ' Ничего не записано.
' Укажите причину недобора людей в строках:
Private Const M_NOTHING_2   As String = "423 43A 430 436 438 442 435 20 43F 440 438 447 438 43D 443 20 43D 435 434 43E 431 43E 440 430 20 43B 44E 434 " & _
    "435 439 20 432 20 441 442 440 43E 43A 430 445 3A"
' Нужна причина недобора (модуль v8.5)
Private Const M_T_REASON    As String = "41D 443 436 43D 430 20 43F 440 438 447 438 43D 430 20 43D 435 434 43E 431 43E 440 430 20 28 43C 43E 434 443 " & _
    "43B 44C 20 76 38 2E 35 29"
Private Const M_PLAN_OPEN   As String = "20 28 43F 43B 430 43D 20"   '  (план 
Private Const M_FACT_MID    As String = "2C 20 444 430 43A 442 20"   ' , факт 
' Оценка выставлена не по всем критериям:
Private Const M_PARTIAL_1   As String = "41E 446 435 43D 43A 430 20 432 44B 441 442 430 432 43B 435 43D 430 20 43D 435 20 43F 43E 20 432 441 435 43C 20 " & _
    "43A 440 438 442 435 440 438 44F 43C 3A"
Private Const M_PARTIAL_2   As String = "3A 20 437 430 43F 43E 43B 43D 435 43D 43E 20 43A 440 438 442 435 440 438 435 432 20"   ' : заполнено критериев 
Private Const M_PARTIAL_3   As String = "20 438 437 20 35"   '  из 5
' Итоговый балл будет рассчитан только по заполненным критериям.
Private Const M_PARTIAL_4   As String = "418 442 43E 433 43E 432 44B 439 20 431 430 43B 43B 20 431 443 434 435 442 20 440 430 441 441 447 438 442 430 " & _
    "43D 20 442 43E 43B 44C 43A 43E 20 43F 43E 20 437 430 43F 43E 43B 43D 435 43D 43D 44B 43C 20 43A 440 438 442 " & _
    "435 440 438 44F 43C 2E"
Private Const M_PARTIAL_5   As String = "417 430 43F 438 441 430 442 44C 20 432 441 451 20 440 430 432 43D 43E 3F"   ' Записать всё равно?
Private Const M_T_PARTIAL   As String = "41D 435 43F 43E 43B 43D 430 44F 20 43E 446 435 43D 43A 430"   ' Неполная оценка
Private Const M_DUP_1       As String = "417 430 20"   ' За 
Private Const M_DUP_2       As String = "20 443 436 435 20 435 441 442 44C 20 434 430 43D 43D 44B 435 20 43F 43E 3A"   '  уже есть данные по:
' Перезаписать данные по этим подрядчикам?
Private Const M_DUP_3       As String = "41F 435 440 435 437 430 43F 438 441 430 442 44C 20 434 430 43D 43D 44B 435 20 43F 43E 20 44D 442 438 43C 20 " & _
    "43F 43E 434 440 44F 434 447 438 43A 430 43C 3F"
Private Const M_DUP_4       As String = "414 430 20 2014 20 43E 431 43D 43E 432 438 442 44C 20 438 20 434 43E 43F 438 441 430 442 44C 2E"   ' Да — обновить и дописать.
' Нет — отменить (форма сохранится, проверьте дату).
Private Const M_DUP_5       As String = "41D 435 442 20 2014 20 43E 442 43C 435 43D 438 442 44C 20 28 444 43E 440 43C 430 20 441 43E 445 440 430 43D " & _
    "438 442 441 44F 2C 20 43F 440 43E 432 435 440 44C 442 435 20 434 430 442 443 29 2E"
Private Const M_T_DUP       As String = "414 430 43D 43D 44B 435 20 443 436 435 20 435 441 442 44C"   ' Данные уже есть
' Запись отменена. Данные в форме сохранены.
Private Const M_CANCEL_1    As String = "417 430 43F 438 441 44C 20 43E 442 43C 435 43D 435 43D 430 2E 20 414 430 43D 43D 44B 435 20 432 20 444 43E 440 " & _
    "43C 435 20 441 43E 445 440 430 43D 435 43D 44B 2E"
' Проверьте дату в C4 и повторите.
Private Const M_CANCEL_2    As String = "41F 440 43E 432 435 440 44C 442 435 20 434 430 442 443 20 432 20 43 34 20 438 20 43F 43E 432 442 43E 440 438 " & _
    "442 435 2E"
Private Const M_T_CANCEL    As String = "41E 442 43C 435 43D 435 43D 43E"   ' Отменено
Private Const M_RES_ADD     As String = "414 43E 431 430 432 43B 435 43D 43E 3A 20"   ' Добавлено: 
Private Const M_RES_UPD     As String = "41E 431 43D 43E 432 43B 435 43D 43E 3A 20"   ' Обновлено: 
Private Const M_RES_DEC     As String = "41F 435 440 435 43D 435 441 435 43D 43E 20 440 435 448 435 43D 438 439 3A 20"   ' Перенесено решений: 
Private Const M_T_DONE      As String = "413 43E 442 43E 432 43E 20 2014 20 43C 43E 434 443 43B 44C 20 76 38 2E 35"   ' Готово — модуль v8.5
Private Const M_ERR         As String = "41E 448 438 431 43A 430 3A 20"   ' Ошибка: 
' По этим строкам причина указывает на вину подрядчика,
Private Const M_NEED_DEC_1  As String = "41F 43E 20 44D 442 438 43C 20 441 442 440 43E 43A 430 43C 20 43F 440 438 447 438 43D 430 20 443 43A 430 437 " & _
    "44B 432 430 435 442 20 43D 430 20 432 438 43D 443 20 43F 43E 434 440 44F 434 447 438 43A 430 2C"
' поэтому нужно выбрать решение в столбце «Решение»:
Private Const M_NEED_DEC_2  As String = "43F 43E 44D 442 43E 43C 443 20 43D 443 436 43D 43E 20 432 44B 431 440 430 442 44C 20 440 435 448 435 43D 438 " & _
    "435 20 432 20 441 442 43E 43B 431 446 435 20 AB 420 435 448 435 43D 438 435 BB 3A"
Private Const M_REASON_OPEN As String = "20 28 43F 440 438 447 438 43D 430 3A 20"   '  (причина: 
' Нужно решение по подрядчику (модуль v8.5)
Private Const M_T_NEED_DEC  As String = "41D 443 436 43D 43E 20 440 435 448 435 43D 438 435 20 43F 43E 20 43F 43E 434 440 44F 434 447 438 43A 443 20 28 " & _
    "43C 43E 434 443 43B 44C 20 76 38 2E 35 29"
' Сегодня пятница — оценка качества обязательна.
Private Const M_FRI_1       As String = "421 435 433 43E 434 43D 44F 20 43F 44F 442 43D 438 446 430 20 2014 20 43E 446 435 43D 43A 430 20 43A 430 447 " & _
    "435 441 442 432 430 20 43E 431 44F 437 430 442 435 43B 44C 43D 430 2E"
' Заполните все 5 критериев в строках:
Private Const M_FRI_2       As String = "417 430 43F 43E 43B 43D 438 442 435 20 432 441 435 20 35 20 43A 440 438 442 435 440 438 435 432 20 432 20 441 " & _
    "442 440 43E 43A 430 445 3A"
' Нужна оценка качества (модуль v8.5)
Private Const M_T_FRIDAY    As String = "41D 443 436 43D 430 20 43E 446 435 43D 43A 430 20 43A 430 447 435 441 442 432 430 20 28 43C 43E 434 443 43B " & _
    "44C 20 76 38 2E 35 29"
Private Const M_SAVED       As String = "424 430 439 43B 20 441 43E 445 440 430 43D 451 43D 2E"   ' Файл сохранён.
' ВНИМАНИЕ: файл не сохранён, сохраните вручную (Ctrl+S).
Private Const M_NOT_SAVED   As String = "412 41D 418 41C 410 41D 418 415 3A 20 444 430 439 43B 20 43D 435 20 441 43E 445 440 430 43D 451 43D 2C 20 441 " & _
    "43E 445 440 430 43D 438 442 435 20 432 440 443 447 43D 443 44E 20 28 43 74 72 6C 2B 53 29 2E"
' Файл открыт только для чтения — сохраните копию вручную.
Private Const M_RO_SAVED    As String = "424 430 439 43B 20 43E 442 43A 440 44B 442 20 442 43E 43B 44C 43A 43E 20 434 43B 44F 20 447 442 435 43D 438 " & _
    "44F 20 2014 20 441 43E 445 440 430 43D 438 442 435 20 43A 43E 43F 438 44E 20 432 440 443 447 43D 443 44E 2E"
Private Const M_ST_VER      As String = "41C 43E 434 443 43B 44C 20 76 38 2E 35"   ' Модуль v8.5
Private Const M_ST_PLAT_MAC As String = "41F 43B 430 442 444 43E 440 43C 430 3A 20 6D 61 63 4F 53"   ' Платформа: macOS
Private Const M_ST_PLAT_WIN As String = "41F 43B 430 442 444 43E 440 43C 430 3A 20 57 69 6E 64 6F 77 73"   ' Платформа: Windows
Private Const M_ST_DECODE   As String = "420 430 441 43A 43E 434 438 440 43E 432 43A 430 20 438 43C 451 43D 3A 20"   ' Раскодировка имён: 
Private Const M_ST_COLL_OK  As String = "43 6F 6C 6C 65 63 74 69 6F 6E 3A 20 440 430 431 43E 442 430 435 442"   ' Collection: работает
Private Const M_ST_COLL_ERR As String = "43 6F 6C 6C 65 63 74 69 6F 6E 3A 20 41E 428 418 411 41A 410"   ' Collection: ОШИБКА
Private Const M_ST_SHF_OK   As String = "41B 438 441 442 20 444 43E 440 43C 44B 3A 20 43D 430 439 434 435 43D"   ' Лист формы: найден
Private Const M_ST_SHF_NO   As String = "41B 438 441 442 20 444 43E 440 43C 44B 3A 20 41D 415 20 41D 410 419 414 415 41D"   ' Лист формы: НЕ НАЙДЕН
Private Const M_ST_SHD_OK   As String = "41B 438 441 442 20 43E 442 447 451 442 430 3A 20 43D 430 439 434 435 43D"   ' Лист отчёта: найден
Private Const M_ST_SHD_NO   As String = "41B 438 441 442 20 43E 442 447 451 442 430 3A 20 41D 415 20 41D 410 419 414 415 41D"   ' Лист отчёта: НЕ НАЙДЕН
Private Const M_ST_TBF_OK   As String = "422 430 431 43B 438 446 430 20 444 43E 440 43C 44B 3A 20 43D 430 439 434 435 43D 430"   ' Таблица формы: найдена
Private Const M_ST_TBF_NO   As String = "422 430 431 43B 438 446 430 20 444 43E 440 43C 44B 3A 20 41D 415 20 41D 410 419 414 415 41D 410"   ' Таблица формы: НЕ НАЙДЕНА
Private Const M_ST_TBD_OK   As String = "422 430 431 43B 438 446 430 20 43E 442 447 451 442 430 3A 20 43D 430 439 434 435 43D 430"   ' Таблица отчёта: найдена
Private Const M_ST_TBD_NO   As String = "422 430 431 43B 438 446 430 20 43E 442 447 451 442 430 3A 20 41D 415 20 41D 410 419 414 415 41D 410"   ' Таблица отчёта: НЕ НАЙДЕНА
Private Const M_ST_COLF     As String = "421 442 43E 43B 431 446 44B 20 444 43E 440 43C 44B 3A 20"   ' Столбцы формы: 
Private Const M_ST_COLD     As String = "421 442 43E 43B 431 446 44B 20 43E 442 447 451 442 430 3A 20"   ' Столбцы отчёта: 
Private Const M_ST_CRF      As String = "41A 440 438 442 435 440 438 438 20 432 20 444 43E 440 43C 435 3A 20"   ' Критерии в форме: 
Private Const M_ST_CRD      As String = "41A 440 438 442 435 440 438 438 20 432 20 43E 442 447 451 442 435 3A 20"   ' Критерии в отчёте: 
Private Const M_ST_OF8      As String = "20 438 437 20 38"   '  из 8
Private Const M_ST_OF9      As String = "20 438 437 20 39"   '  из 9
Private Const M_ST_OF5      As String = "20 438 437 20 35"   '  из 5
' ИТОГ: всё на месте, можно работать.
Private Const M_ST_OK       As String = "418 422 41E 413 3A 20 432 441 451 20 43D 430 20 43C 435 441 442 435 2C 20 43C 43E 436 43D 43E 20 440 430 431 " & _
    "43E 442 430 442 44C 2E"
' ИТОГ: есть проблемы, смотрите строки выше.
Private Const M_ST_BAD      As String = "418 422 41E 413 3A 20 435 441 442 44C 20 43F 440 43E 431 43B 435 43C 44B 2C 20 441 43C 43E 442 440 438 442 435 " & _
    "20 441 442 440 43E 43A 438 20 432 44B 448 435 2E"
Private Const M_ST_TITLE    As String = "421 430 43C 43E 43F 440 43E 432 435 440 43A 430"   ' Самопроверка
Private Const M_ST_SEP      As String = "20 2F 20"   '  / 


Sub ZapisatOtchet()
    Dim wsF As Worksheet, tblF As ListObject
    Dim wsD As Worksheet, tblD As ListObject
    Dim r As Range, nr As ListRow
    Dim dt As Variant, score As Variant, arr As Variant
    Dim added As Long, updated As Long
    Dim fWork As Long, fDetail As Long, fContr As Long, fPlan As Long
    Dim fFact As Long, fReason As Long, fScore As Long, fDecision As Long
    Dim dDate As Long, dWork As Long, dDetail As Long, dContr As Long
    Dim dScore As Long, dPlan As Long, dFact As Long, dReason As Long, dDecision As Long
    Dim fCrit(1 To 5) As Long, dCrit(1 To 5) As Long
    Dim critForm(1 To 5) As String, critData(1 To 5) As String
    Dim contr As String, reason As String, k As String, work As String
    Dim decision As String
    Dim problems As String, dupList As String, partial As String, noDecision As String
    Dim planV As Double, factV As Double
    Dim cnt As Long, cntDec As Long, dupCount As Long, i As Long, idx As Long
    Dim j As Long, filled As Long, decisions As Long
    Dim saved As Boolean, canSave As Boolean
    Dim cntFri As Long, noQuality As String, isFriday As Boolean
    Dim factWeek As Collection, dayNo As Long
    Dim ans As VbMsgBoxResult
    Dim reg As Collection          ' вместо Scripting.Dictionary — работает и на Mac

    On Error GoTo ErrHandler

    Set wsF = ThisWorkbook.Worksheets(RU(N_SH_FORM))
    Set tblF = wsF.ListObjects(RU(N_TBL_FORM))
    Set wsD = ThisWorkbook.Worksheets(RU(N_SH_DATA))
    Set tblD = wsD.ListObjects(RU(N_TBL_DATA))

    If tblF.DataBodyRange Is Nothing Then
        MsgBox RU(M_EMPTY_FORM), vbExclamation, RU(M_T_NO_DATA)
        Exit Sub
    End If

    dt = wsF.Range("C4").Value
    If Not IsDate(dt) Then
        MsgBox RU(M_NEED_DATE), vbExclamation, RU(M_T_NO_DATE)
        Exit Sub
    End If

    critForm(1) = RU(N_F_C1): critForm(2) = RU(N_F_C2): critForm(3) = RU(N_F_C3)
    critForm(4) = RU(N_F_C4): critForm(5) = RU(N_F_C5)
    critData(1) = RU(N_D_C1): critData(2) = RU(N_D_C2): critData(3) = RU(N_D_C3)
    critData(4) = RU(N_D_C4): critData(5) = RU(N_D_C5)

    ' --- индексы столбцов формы ---
    fWork = ColIndex(tblF, RU(N_F_WORK))
    fDetail = ColIndex(tblF, RU(N_F_DETAIL))
    fContr = ColIndex(tblF, RU(N_F_CONTR))
    fPlan = ColIndex(tblF, RU(N_F_PLAN))
    fFact = ColIndex(tblF, RU(N_F_FACT))
    fReason = ColIndex(tblF, RU(N_F_REASON))
    fScore = ColIndex(tblF, RU(N_F_SCORE))
    fDecision = ColIndex(tblF, RU(N_F_DECISION))
    For j = 1 To 5
        fCrit(j) = ColIndex(tblF, critForm(j))
    Next j

    If fWork * fDetail * fContr * fPlan * fFact * fReason * fScore = 0 Then
        MsgBox RU(M_BAD_FORM), vbCritical, RU(M_T_BAD_FORM)
        Exit Sub
    End If

    ' --- индексы столбцов плоской таблицы ---
    dDate = ColIndex(tblD, RU(N_D_DATE))
    dWork = ColIndex(tblD, RU(N_D_WORK))
    dDetail = ColIndex(tblD, RU(N_D_DETAIL))
    dContr = ColIndex(tblD, RU(N_D_CONTR))
    dScore = ColIndex(tblD, RU(N_D_SCORE))
    dPlan = ColIndex(tblD, RU(N_D_PLAN))
    dFact = ColIndex(tblD, RU(N_D_FACT))
    dReason = ColIndex(tblD, RU(N_D_REASON))
    dDecision = ColIndex(tblD, RU(N_D_DECISION))
    For j = 1 To 5
        dCrit(j) = ColIndex(tblD, critData(j))
    Next j

    If dDate * dWork * dDetail * dContr * dScore * dPlan * dFact * dReason = 0 Then
        MsgBox RU(M_BAD_DATA), vbCritical, RU(M_T_BAD_DATA)
        Exit Sub
    End If
    If fDecision = 0 Or dDecision = 0 Then
        MsgBox RU(M_NO_DEC_1) & vbCrLf & RU(M_NO_DEC_2), vbExclamation, RU(M_T_NO_DEC)
    End If

    ' --- 1. причина недобора людей ---
    For Each r In tblF.DataBodyRange.Rows
        If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
            contr = Trim(r.Cells(1, fContr).Value & "")
            reason = Trim(r.Cells(1, fReason).Value & "")
            planV = ToNum(r.Cells(1, fPlan).Value)
            factV = ToNum(r.Cells(1, fFact).Value)
            work = Trim(r.Cells(1, fWork).Value & "")

            If contr = "" Then
                contr = work & " / " & Trim(r.Cells(1, fDetail).Value & "")
            Else
                contr = contr & " - " & work
            End If

            decision = ""
            If fDecision > 0 Then decision = Trim(r.Cells(1, fDecision).Value & "")

            ' Для собственных сил ни причина, ни решение не требуются:
            ' это не подрядчик, претензий и замен по нему не бывает.
            If StrComp(work, RU(N_OWN), vbTextCompare) <> 0 Then

                ' Причина нужна только при недоборе людей (факт < плана).
                ' Перевыполнение причину не требует.
                If factV < planV And reason = "" Then
                    cnt = cnt + 1
                    problems = problems & "  - " & contr & RU(M_PLAN_OPEN) & planV & _
                               RU(M_FACT_MID) & factV & ")" & vbCrLf
                End If

                ' Причина прямо указывает на вину подрядчика —
                ' РП обязан выбрать решение по нему.
                If NeedsDecision(reason) And decision = "" Then
                    cntDec = cntDec + 1
                    noDecision = noDecision & "  - " & contr & RU(M_REASON_OPEN) & reason & ")" & vbCrLf
                End If
            End If
        End If
    Next r

    If cnt > 0 Then
        MsgBox RU(M_NOTHING_1) & vbCrLf & RU(M_NOTHING_2) & vbCrLf & vbCrLf & _
               problems, vbExclamation, RU(M_T_REASON)
        Exit Sub
    End If

    If cntDec > 0 Then
        MsgBox RU(M_NOTHING_1) & vbCrLf & RU(M_NEED_DEC_1) & vbCrLf & _
               RU(M_NEED_DEC_2) & vbCrLf & vbCrLf & _
               noDecision, vbExclamation, RU(M_T_NEED_DEC)
        Exit Sub
    End If

    ' --- 2. пятница: оценка качества обязательна ---
    ' Исключения: собственные силы, строки без подрядчика и строки,
    ' где решение прямо говорит, что подрядчика на работе нет.
    isFriday = False
    If FRIDAY_QUALITY And IsDate(dt) Then
        isFriday = (Weekday(CDate(dt), vbMonday) = 5)
    End If

    If isFriday Then
        ' Суммарная явка по каждому подрядчику за последние WEEK_DAYS дней,
        ' включая текущую дату: история из отчёта плюс сегодняшняя форма.
        Set factWeek = New Collection
        If Not tblD.DataBodyRange Is Nothing Then
            arr = tblD.DataBodyRange.Value
            If IsArray(arr) Then
                For i = 1 To UBound(arr, 1)
                    If IsDate(arr(i, dDate)) Then
                        dayNo = CLng(CDate(arr(i, dDate)))
                        If dayNo > CLng(CDate(dt)) - WEEK_DAYS And dayNo <= CLng(CDate(dt)) Then
                            AddFact factWeek, LCase$(Trim(arr(i, dContr) & "")), ToNum(arr(i, dFact))
                        End If
                    End If
                Next i
            End If
        End If
        For Each r In tblF.DataBodyRange.Rows
            If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
                AddFact factWeek, LCase$(Trim(r.Cells(1, fContr).Value & "")), _
                        ToNum(r.Cells(1, fFact).Value)
            End If
        Next r

        For Each r In tblF.DataBodyRange.Rows
            If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
                contr = Trim(r.Cells(1, fContr).Value & "")
                work = Trim(r.Cells(1, fWork).Value & "")
                decision = ""
                If fDecision > 0 Then decision = Trim(r.Cells(1, fDecision).Value & "")

                ' Оценку требуем только если подрядчик за неделю
                ' хоть раз выводил людей: GetFact > 0.
                If contr <> "" _
                   And StrComp(work, RU(N_OWN), vbTextCompare) <> 0 _
                   And Not NoContractor(decision) _
                   And GetFact(factWeek, LCase$(contr)) > 0 Then

                    filled = 0
                    For j = 1 To 5
                        If fCrit(j) > 0 Then
                            If Len(Trim(r.Cells(1, fCrit(j)).Value & "")) > 0 Then filled = filled + 1
                        End If
                    Next j
                    If filled < 5 Then
                        cntFri = cntFri + 1
                        noQuality = noQuality & "  - " & contr & " - " & work & _
                                    RU(M_PARTIAL_2) & filled & RU(M_PARTIAL_3) & vbCrLf
                    End If
                End If
            End If
        Next r

        If cntFri > 0 Then
            MsgBox RU(M_NOTHING_1) & vbCrLf & RU(M_FRI_1) & vbCrLf & _
                   RU(M_FRI_2) & vbCrLf & vbCrLf & _
                   noQuality, vbExclamation, RU(M_T_FRIDAY)
            Exit Sub
        End If
    End If

    ' --- 3. полнота оценки по 5 критериям (предупреждение, не блокировка) ---
    For Each r In tblF.DataBodyRange.Rows
        If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
            contr = Trim(r.Cells(1, fContr).Value & "")
            If contr <> "" Then
                filled = 0
                For j = 1 To 5
                    If fCrit(j) > 0 Then
                        If Len(Trim(r.Cells(1, fCrit(j)).Value & "")) > 0 Then filled = filled + 1
                    End If
                Next j
                If filled > 0 And filled < 5 Then
                    partial = partial & "  - " & contr & RU(M_PARTIAL_2) & filled & RU(M_PARTIAL_3) & vbCrLf
                End If
            End If
        End If
    Next r
    If Len(partial) > 0 Then
        ans = MsgBox(RU(M_PARTIAL_1) & vbCrLf & vbCrLf & partial & vbCrLf & _
                     RU(M_PARTIAL_4) & vbCrLf & RU(M_PARTIAL_5), _
                     vbYesNo + vbQuestion, RU(M_T_PARTIAL))
        If ans <> vbYes Then Exit Sub
    End If

    ' --- 4. индекс уже внесённых строк ---
    Set reg = New Collection
    If Not tblD.DataBodyRange Is Nothing Then
        arr = tblD.DataBodyRange.Value
        If IsArray(arr) Then
            For i = 1 To UBound(arr, 1)
                If IsDate(arr(i, dDate)) Then
                    k = RowKey(arr(i, dDate), arr(i, dWork), arr(i, dDetail), arr(i, dContr))
                    AddKey reg, k, i
                End If
            Next i
        End If
    End If

    ' --- 5. поиск дублей за эту дату ---
    For Each r In tblF.DataBodyRange.Rows
        If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
            k = RowKey(dt, r.Cells(1, fWork).Value, r.Cells(1, fDetail).Value, r.Cells(1, fContr).Value)
            If RowNo(reg, k) > 0 Then
                dupCount = dupCount + 1
                contr = Trim(r.Cells(1, fContr).Value & "")
                If contr = "" Then contr = Trim(r.Cells(1, fWork).Value & "") & " / " & Trim(r.Cells(1, fDetail).Value & "")
                If InStr(dupList, "- " & contr & vbCrLf) = 0 Then dupList = dupList & "  - " & contr & vbCrLf
            End If
        End If
    Next r

    If dupCount > 0 Then
        ans = MsgBox(RU(M_DUP_1) & Format(dt, "DD.MM.YYYY") & RU(M_DUP_2) & vbCrLf & vbCrLf & _
                     dupList & vbCrLf & RU(M_DUP_3) & vbCrLf & _
                     RU(M_DUP_4) & vbCrLf & RU(M_DUP_5), _
                     vbYesNo + vbQuestion, RU(M_T_DUP))
        If ans <> vbYes Then
            MsgBox RU(M_CANCEL_1) & vbCrLf & RU(M_CANCEL_2), vbInformation, RU(M_T_CANCEL)
            Exit Sub
        End If
    End If

    ' --- 6. запись / обновление ---
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationAutomatic

    For Each r In tblF.DataBodyRange.Rows
        If Len(Trim(r.Cells(1, fFact).Value & "")) > 0 Then
            k = RowKey(dt, r.Cells(1, fWork).Value, r.Cells(1, fDetail).Value, r.Cells(1, fContr).Value)
            score = r.Cells(1, fScore).Value
            idx = RowNo(reg, k)

            If idx > 0 Then
                tblD.DataBodyRange.Cells(idx, dPlan).Value = r.Cells(1, fPlan).Value
                tblD.DataBodyRange.Cells(idx, dFact).Value = r.Cells(1, fFact).Value
                tblD.DataBodyRange.Cells(idx, dReason).Value = r.Cells(1, fReason).Value
                If IsNumeric(score) And Len(Trim(score & "")) > 0 Then
                    tblD.DataBodyRange.Cells(idx, dScore).Value = score
                Else
                    tblD.DataBodyRange.Cells(idx, dScore).Value = ""
                End If
                If fDecision > 0 And dDecision > 0 Then
                    tblD.DataBodyRange.Cells(idx, dDecision).Value = Trim(r.Cells(1, fDecision).Value & "")
                End If
                For j = 1 To 5
                    If fCrit(j) > 0 And dCrit(j) > 0 Then
                        tblD.DataBodyRange.Cells(idx, dCrit(j)).Value = Trim(r.Cells(1, fCrit(j)).Value & "")
                    End If
                Next j
                updated = updated + 1
            Else
                Set nr = tblD.ListRows.Add
                nr.Range.Cells(1, dDate).Value = dt
                nr.Range.Cells(1, dWork).Value = r.Cells(1, fWork).Value
                nr.Range.Cells(1, dDetail).Value = r.Cells(1, fDetail).Value
                nr.Range.Cells(1, dContr).Value = r.Cells(1, fContr).Value
                nr.Range.Cells(1, dPlan).Value = r.Cells(1, fPlan).Value
                nr.Range.Cells(1, dFact).Value = r.Cells(1, fFact).Value
                nr.Range.Cells(1, dReason).Value = r.Cells(1, fReason).Value
                If IsNumeric(score) And Len(Trim(score & "")) > 0 Then
                    nr.Range.Cells(1, dScore).Value = score
                End If
                If fDecision > 0 And dDecision > 0 Then
                    nr.Range.Cells(1, dDecision).Value = Trim(r.Cells(1, fDecision).Value & "")
                End If
                For j = 1 To 5
                    If fCrit(j) > 0 And dCrit(j) > 0 Then
                        nr.Range.Cells(1, dCrit(j)).Value = Trim(r.Cells(1, fCrit(j)).Value & "")
                    End If
                Next j
                added = added + 1
                AddKey reg, k, tblD.DataBodyRange.Rows.Count
            End If

            If fDecision > 0 Then
                If Len(Trim(r.Cells(1, fDecision).Value & "")) > 0 Then decisions = decisions + 1
            End If
        End If
    Next r

    ' --- 7. очистка формы (только после успешной записи) ---
    tblF.ListColumns(RU(N_F_FACT)).DataBodyRange.ClearContents
    tblF.ListColumns(RU(N_F_REASON)).DataBodyRange.ClearContents
    For j = 1 To 5
        If fCrit(j) > 0 Then tblF.ListColumns(critForm(j)).DataBodyRange.ClearContents
    Next j
    If fDecision > 0 Then tblF.ListColumns(RU(N_F_DECISION)).DataBodyRange.ClearContents

    Application.CalculateFull
    Application.ScreenUpdating = True

    ' --- 8. автосохранение книги ---
    ' Сохраняем уже после очистки формы и пересчёта, чтобы на диск
    ' попало то же, что видит пользователь на экране.
    saved = False
    canSave = False
    If AUTOSAVE Then
        On Error Resume Next
        canSave = (Len(ThisWorkbook.Path) > 0) And (Not ThisWorkbook.ReadOnly)
        If canSave Then
            Application.DisplayAlerts = False
            ThisWorkbook.Save
            saved = (Err.Number = 0)
            Application.DisplayAlerts = True
        End If
        Err.Clear
        On Error GoTo ErrHandler
    End If

    k = RU(M_RES_ADD) & added & vbCrLf & RU(M_RES_UPD) & updated
    If decisions > 0 Then k = k & vbCrLf & RU(M_RES_DEC) & decisions
    If AUTOSAVE Then
        If saved Then
            k = k & vbCrLf & vbCrLf & RU(M_SAVED)
        ElseIf Not canSave Then
            k = k & vbCrLf & vbCrLf & RU(M_RO_SAVED)
        Else
            k = k & vbCrLf & vbCrLf & RU(M_NOT_SAVED)
        End If
    End If
    MsgBox k, vbInformation, RU(M_T_DONE)
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox RU(M_ERR) & Err.Description, vbCritical
End Sub


' ==========================================================
'  Самопроверка среды — запускать на новой машине ПЕРЕД работой.
'  Ничего не меняет в книге, только читает и показывает отчёт.
' ==========================================================
Sub SelfTest()
    Dim wsF As Worksheet, wsD As Worksheet
    Dim tblF As ListObject, tblD As ListObject
    Dim rep As String, j As Long, i2 As Long, okAll As Boolean
    Dim critForm(1 To 5) As String, critData(1 To 5) As String
    Dim reg As Collection

    okAll = True
    rep = RU(M_ST_VER) & vbCrLf

    ' 1. платформа
#If Mac Then
    rep = rep & RU(M_ST_PLAT_MAC) & vbCrLf
#Else
    rep = rep & RU(M_ST_PLAT_WIN) & vbCrLf
#End If

    ' 2. раскодировка имён — проверяет ChrW и целостность констант
    rep = rep & RU(M_ST_DECODE) & RU(N_SH_FORM) & RU(M_ST_SEP) & RU(N_TBL_DATA) & vbCrLf & vbCrLf

    ' 3. Collection вместо Dictionary
    On Error Resume Next
    Set reg = New Collection
    reg.Add 1, "x"
    If Err.Number <> 0 Or RowNo(reg, "x") <> 1 Then
        rep = rep & RU(M_ST_COLL_ERR) & vbCrLf
        okAll = False
    Else
        rep = rep & RU(M_ST_COLL_OK) & vbCrLf
    End If
    Err.Clear
    On Error GoTo 0

    ' 4. листы и таблицы
    On Error Resume Next
    Set wsF = ThisWorkbook.Worksheets(RU(N_SH_FORM))
    Set wsD = ThisWorkbook.Worksheets(RU(N_SH_DATA))
    On Error GoTo 0

    If wsF Is Nothing Then
        rep = rep & RU(M_ST_SHF_NO) & vbCrLf
        okAll = False
    Else
        rep = rep & RU(M_ST_SHF_OK) & vbCrLf
    End If

    If wsD Is Nothing Then
        rep = rep & RU(M_ST_SHD_NO) & vbCrLf
        okAll = False
    Else
        rep = rep & RU(M_ST_SHD_OK) & vbCrLf
    End If

    If Not wsF Is Nothing Then
        On Error Resume Next
        Set tblF = wsF.ListObjects(RU(N_TBL_FORM))
        On Error GoTo 0
    End If
    If Not wsD Is Nothing Then
        On Error Resume Next
        Set tblD = wsD.ListObjects(RU(N_TBL_DATA))
        On Error GoTo 0
    End If

    If tblF Is Nothing Then
        rep = rep & RU(M_ST_TBF_NO) & vbCrLf
        okAll = False
    Else
        rep = rep & RU(M_ST_TBF_OK) & vbCrLf
    End If

    If tblD Is Nothing Then
        rep = rep & RU(M_ST_TBD_NO) & vbCrLf
        okAll = False
    Else
        rep = rep & RU(M_ST_TBD_OK) & vbCrLf
    End If

    ' 5. столбцы
    critForm(1) = RU(N_F_C1): critForm(2) = RU(N_F_C2): critForm(3) = RU(N_F_C3)
    critForm(4) = RU(N_F_C4): critForm(5) = RU(N_F_C5)
    critData(1) = RU(N_D_C1): critData(2) = RU(N_D_C2): critData(3) = RU(N_D_C3)
    critData(4) = RU(N_D_C4): critData(5) = RU(N_D_C5)

    If Not tblF Is Nothing Then
        j = 0
        If ColIndex(tblF, RU(N_F_WORK)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_DETAIL)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_CONTR)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_PLAN)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_FACT)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_REASON)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_SCORE)) > 0 Then j = j + 1
        If ColIndex(tblF, RU(N_F_DECISION)) > 0 Then j = j + 1
        rep = rep & RU(M_ST_COLF) & j & RU(M_ST_OF8) & vbCrLf
        If j < 8 Then okAll = False

        j = 0
        For i2 = 1 To 5
            If ColIndex(tblF, critForm(i2)) > 0 Then j = j + 1
        Next i2
        rep = rep & RU(M_ST_CRF) & j & RU(M_ST_OF5) & vbCrLf
        If j < 5 Then okAll = False
    End If

    If Not tblD Is Nothing Then
        j = 0
        If ColIndex(tblD, RU(N_D_DATE)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_WORK)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_DETAIL)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_CONTR)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_SCORE)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_PLAN)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_FACT)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_REASON)) > 0 Then j = j + 1
        If ColIndex(tblD, RU(N_D_DECISION)) > 0 Then j = j + 1
        rep = rep & RU(M_ST_COLD) & j & RU(M_ST_OF9) & vbCrLf
        If j < 9 Then okAll = False

        j = 0
        For i2 = 1 To 5
            If ColIndex(tblD, critData(i2)) > 0 Then j = j + 1
        Next i2
        rep = rep & RU(M_ST_CRD) & j & RU(M_ST_OF5) & vbCrLf
        If j < 5 Then okAll = False
    End If

    If okAll Then
        rep = rep & vbCrLf & RU(M_ST_OK)
        MsgBox rep, vbInformation, RU(M_ST_TITLE)
    Else
        rep = rep & vbCrLf & RU(M_ST_BAD)
        MsgBox rep, vbExclamation, RU(M_ST_TITLE)
    End If
End Sub


' ==========================================================
'  Служебные функции
' ==========================================================

' Собирает текст из строки Unicode-кодов вида "424 43E 440".
' Так имена листов и столбцов не зависят от кодировки файла.
Private Function RU(ByVal codeList As String) As String
    Dim parts() As String, i As Long, s As String
    parts = Split(Trim(codeList), " ")
    For i = LBound(parts) To UBound(parts)
        If Len(parts(i)) > 0 Then s = s & ChrW$(CLng("&H" & parts(i)))
    Next i
    RU = s
End Function


' Накопление суммы по ключу. У Collection нет обновления элемента,
' поэтому старое значение удаляется и добавляется новое.
Private Sub AddFact(reg As Collection, k As String, v As Double)
    Dim cur As Double
    If Len(k) = 0 Then Exit Sub
    cur = GetFact(reg, k)
    On Error Resume Next
    reg.Remove k
    Err.Clear
    reg.Add cur + v, k
    Err.Clear
    On Error GoTo 0
End Sub


' Накопленная сумма по ключу; 0 — если ключа нет
Private Function GetFact(reg As Collection, k As String) As Double
    Dim v As Variant
    GetFact = 0
    If reg Is Nothing Then Exit Function
    If Len(k) = 0 Then Exit Function
    On Error Resume Next
    v = reg.Item(k)
    If Err.Number = 0 Then
        If IsNumeric(v) Then GetFact = CDbl(v)
    End If
    Err.Clear
    On Error GoTo 0
End Function


' Говорит ли решение о том, что подрядчика на работе нет.
' Такие строки освобождаются от обязательной пятничной оценки.
Private Function NoContractor(ByVal decision As String) As Boolean
    Dim t As String
    NoContractor = False
    t = Trim(decision)
    If Len(t) = 0 Then Exit Function
    NoContractor = (InStr(1, t, RU(N_DEC_NO_CONTR), vbTextCompare) > 0)
End Function


' Требует ли эта причина обязательного решения по подрядчику.
' Сравнение без учёта регистра и лишних пробелов.
' Чтобы добавить ещё одну причину, допишите её в N_REASON_DEC
' через знак "|" (код 7C).
Private Function NeedsDecision(ByVal reason As String) As Boolean
    Dim lst() As String, i As Long, pat As String
    NeedsDecision = False
    If Len(Trim(reason)) = 0 Then Exit Function

    lst = Split(RU(N_REASON_DEC), "|")
    For i = LBound(lst) To UBound(lst)
        pat = Trim(lst(i))
        If Len(pat) > 0 Then
            If StrComp(Trim(reason), pat, vbTextCompare) = 0 Then
                NeedsDecision = True
                Exit Function
            End If
        End If
    Next i
End Function


' Добавить ключ в реестр. Дубликат вызывает ошибку — гасим её,
' первое вхождение остаётся.
Private Sub AddKey(reg As Collection, k As String, i As Long)
    On Error Resume Next
    reg.Add i, k
    Err.Clear
    On Error GoTo 0
End Sub


' Номер строки по ключу; 0 — если ключа нет
Private Function RowNo(reg As Collection, k As String) As Long
    Dim v As Variant
    RowNo = 0
    If reg Is Nothing Then Exit Function
    On Error Resume Next
    v = reg.Item(k)
    If Err.Number = 0 Then RowNo = CLng(v)
    Err.Clear
    On Error GoTo 0
End Function


' Индекс столбца таблицы по имени; 0 — если столбца нет
Private Function ColIndex(tbl As ListObject, colName As String) As Long
    Dim lc As ListColumn
    For Each lc In tbl.ListColumns
        If StrComp(Trim(lc.Name), colName, vbTextCompare) = 0 Then
            ColIndex = lc.Index
            Exit Function
        End If
    Next lc
    ColIndex = 0
End Function


Private Function ToNum(v As Variant) As Double
    If IsNumeric(v) Then ToNum = CDbl(v) Else ToNum = 0
End Function


Private Function RowKey(dtv As Variant, wk As Variant, det As Variant, con As Variant) As String
    RowKey = CStr(CLng(CDate(dtv))) & "|" & Trim(wk & "") & "|" & Trim(det & "") & "|" & Trim(con & "")
End Function
