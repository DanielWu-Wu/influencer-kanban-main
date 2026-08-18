import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEmailLanguage, detectReplyLanguage } from '../src/lib/email-language';

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
  assert.equal(detectEmailLanguage('Ciao Daniel, che piacere risentirti! Grazie mille per la risposta.'), 'it');
});

test('回复语言只识别当前正文，不被引用的英语历史干扰', () => {
  assert.equal(
    detectReplyLanguage(`Ciao Daniel, che piacere risentirti! Ho tardato a rispondere perché sono stato in vacanza.\n\nOn Sunday, Daniel wrote:\nThank you for your message. We would like to discuss the collaboration.`),
    'it',
  );
});

test('证据不足的短回复不再静默当作英语回复语言', () => {
  assert.equal(detectEmailLanguage('Hello'), 'en');
  assert.equal(detectReplyLanguage('Hello'), '');
});

test('识别英语和非拉丁文字语言', () => {
  assert.equal(detectEmailLanguage('Thank you for your message. We would like to work with your team.'), 'en');
  assert.equal(detectEmailLanguage('こんにちは。メッセージをありがとうございます。'), 'ja');
  assert.equal(detectEmailLanguage('您好，感谢您的来信。'), 'zh');
  assert.equal(detectEmailLanguage('Дякую за ваше повідомлення та пропозицію.'), 'uk');
});
