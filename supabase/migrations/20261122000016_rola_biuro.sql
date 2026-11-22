-- Rola „biuro”: pracownik biurowy z dostępem do kwot (kosztorysy, faktury, materiał, lakiery, rentowność),
-- bez zakładki Płatności, bez zarządzania kontami, ustawieniami i kosztami firmy (płace).
-- Jak właściciel wymaga drugiego składnika logowania (aal2), bo widzi dane finansowe.

alter type rola_uzytkownika add value if not exists 'biuro';
