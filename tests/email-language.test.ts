import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmailLanguage } from '../src/lib/email-language';

test('识别德语来信', () => {
  assert.equal(
    detectEmailLanguage('Hallo, vielen Dank für deine Nachricht. Ich würde gerne mit euch zusammenarbeiten.'),
    'de',
  );
});

test('识别常用欧洲市场来信语言', () => {
  assert.equal(detectEmailLanguage('Muchas gracias por tu mensaje. Nos gustaría colaborar con vuestro equipo.'), 'es');
  assert.equal(detectEmailLanguage('Hartelijk dank voor jullie bericht. Wij zouden graag met jullie samenwerken.'), 'nl');
  assert.equal(detectEmailLanguage('Muito obrigado pela mensagem. Gostaríamos de trabalhar com vocês.'), 'pt');
  assert.equal(detectEmailLanguage('Dziękuję bardzo za wiadomość. Chcielibyśmy z wami współpracować.'), 'pl');
});

test('识别英语和非拉丁文字语言', () => {
  assert.equal(detectEmailLanguage('Thank you for your message. We would like to work with your team.'), 'en');
  assert.equal(detectEmailLanguage('こんにちは。メッセージをありがとうございます。'), 'ja');
  assert.equal(detectEmailLanguage('您好，感谢您的来信。'), 'zh');
  assert.equal(detectEmailLanguage('Дякую за ваше повідомлення та пропозицію.'), 'uk');
});
