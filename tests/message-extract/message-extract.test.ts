import { describe, it, expect } from 'vitest';
import { __testables } from '../test';

const {
  extractMessageContent,
  formatSenderIdentityPrefix,
  withSenderIdentityPrefix,
  formatSenderDisplayLabel,
} = __testables as any;

const emptyArrays = {
  imageUrls: [],
  downloadCodes: [],
  fileNames: [],
  atDingtalkIds: [],
  atMobiles: [],
};

describe('extractMessageContent', () => {
  describe('msgtype 缺失或 default 分支', () => {
    it.each([
      { data: {}, messageType: 'text', text: '', desc: '空对象' },
      { data: { msgtype: undefined }, messageType: 'text', text: '', desc: 'msgtype undefined' },
      { data: { msgtype: 'unknownType' }, messageType: 'unknownType', text: '[unknownType消息]', desc: '未知类型走 default' },
      { data: { msgtype: null }, messageType: 'text', text: '', desc: 'msgtype null' },
    ] as const)('$desc', ({ data, messageType, text }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe(messageType);
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'text'", () => {
    it.each([
      { data: { msgtype: 'text' }, text: '', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: {} }, text: '', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: { content: ' hello ' } }, text: 'hello', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: { content: 'hi' } }, text: 'hi', atDingtalkIds: [], atMobiles: [] },
      {
        data: {
          msgtype: 'text',
          text: { content: 'hi', at: { atDingtalkIds: ['id1'], atMobiles: ['13800138000'] } },
        },
        text: 'hi',
        atDingtalkIds: ['id1'],
        atMobiles: ['13800138000'],
      },
      {
        data: {
          msgtype: 'text',
          text: { content: 'x', at: { atDingtalkIds: ['a', 'b'], atMobiles: [] } },
        },
        text: 'x',
        atDingtalkIds: ['a', 'b'],
        atMobiles: [],
      },
      { data: { msgtype: 'text', text: { content: '' } }, text: '', atDingtalkIds: [], atMobiles: [] },
    ] as const)('text=$text atDingtalkIds=$atDingtalkIds atMobiles=$atMobiles', ({ data, text, atDingtalkIds, atMobiles }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('text');
      expect(out.text).toBe(text);
      expect(out.atDingtalkIds).toEqual(atDingtalkIds);
      expect(out.atMobiles).toEqual(atMobiles);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
    });
  });

  describe("msgtype === 'richText'", () => {
    it.each([
      { data: { msgtype: 'richText' }, text: '[富文本消息]', imageUrls: [] },
      { data: { msgtype: 'richText', content: {} }, text: '[富文本消息]', imageUrls: [] },
      { data: { msgtype: 'richText', content: { richText: [] } }, text: '[富文本消息]', imageUrls: [] },
      {
        data: { msgtype: 'richText', content: { richText: [{ text: 'a' }, { text: 'b' }] } },
        text: 'ab',
        imageUrls: [],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ pictureUrl: 'http://x/y.png' }] } },
        text: '[图片]',
        imageUrls: ['http://x/y.png'],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ text: 'x', pictureUrl: 'u' }] } },
        text: 'x',
        imageUrls: ['u'],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ type: 'picture', downloadCode: 'code1' }] } },
        text: '[图片]',
        imageUrls: ['downloadCode:code1'],
      },
      {
        data: {
          msgtype: 'richText',
          content: { richText: [{ text: 't', type: 'picture', downloadCode: 'c' }] },
        },
        text: 't',
        imageUrls: ['downloadCode:c'],
      },
    ] as const)('text=$text imageUrls=$imageUrls', ({ data, text, imageUrls }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('richText');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual(imageUrls);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'picture'", () => {
    it.each([
      { data: { msgtype: 'picture' }, text: '[图片]', imageUrls: [], downloadCodes: [] },
      {
        data: { msgtype: 'picture', content: { pictureUrl: 'http://p.png' } },
        text: '[图片]',
        imageUrls: ['http://p.png'],
        downloadCodes: [],
      },
      {
        data: { msgtype: 'picture', content: { downloadCode: 'dc1' } },
        text: '[图片]',
        imageUrls: [],
        downloadCodes: ['dc1'],
      },
      {
        data: { msgtype: 'picture', content: { pictureUrl: 'u', downloadCode: 'c' } },
        text: '[图片]',
        imageUrls: ['u'],
        downloadCodes: ['c'],
      },
    ] as const)('picture branch', ({ data, text, imageUrls, downloadCodes }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('picture');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual(imageUrls);
      expect(out.downloadCodes).toEqual(downloadCodes);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'audio'", () => {
    it('no recognition', () => {
      const out = extractMessageContent({ msgtype: 'audio' });
      expect(out.messageType).toBe('audio');
      expect(out.text).toBe('[语音消息]');
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
    it('with recognition', () => {
      const out = extractMessageContent({ msgtype: 'audio', content: { recognition: '转写文字' } });
      expect(out.messageType).toBe('audio');
      expect(out.text).toBe('转写文字');
    });
  });

  describe("msgtype === 'video'", () => {
    it('video branch', () => {
      const out = extractMessageContent({ msgtype: 'video' });
      expect(out.messageType).toBe('video');
      expect(out.text).toBe('[视频]');
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'file'", () => {
    it.each([
      { data: { msgtype: 'file' }, text: '[文件: 文件]', downloadCodes: [], fileNames: [] },
      {
        data: { msgtype: 'file', content: { fileName: 'a.pdf' } },
        text: '[文件: a.pdf]',
        downloadCodes: [],
        fileNames: [],
      },
      {
        data: { msgtype: 'file', content: { fileName: 'b.docx', downloadCode: 'fc1' } },
        text: '[文件: b.docx]',
        downloadCodes: ['fc1'],
        fileNames: ['b.docx'],
      },
    ] as const)('file branch', ({ data, text, downloadCodes, fileNames }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('file');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual(downloadCodes);
      expect(out.fileNames).toEqual(fileNames);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe('引用消息 quoted / repliedMsg', () => {
    it('引用 text：拼入 [引用] 正文', () => {
      const out = extractMessageContent({
        msgtype: 'text',
        text: {
          content: '这是啥',
          isReplyMsg: true,
          repliedMsg: {
            msgType: 'text',
            content: { text: '产品实拍图' },
          },
        },
      });
      expect(out.text).toContain('这是啥');
      expect(out.text).toContain('[引用] 产品实拍图');
    });

    it('引用 interactiveCard：能从 cardData.msgContent 抠出正文', () => {
      const out = extractMessageContent({
        msgtype: 'text',
        text: {
          content: '总结一下',
          isReplyMsg: true,
          repliedMsg: {
            msgType: 'interactiveCard',
            content: {
              cardData: { msgContent: '维萃美AKG时光抗衰 产品说明……' },
            },
          },
        },
      });
      expect(out.text).toContain('[引用]');
      expect(out.text).toContain('维萃美AKG');
      expect(out.text).not.toBe('总结一下\n[引用] [interactiveCard消息]');
    });

    it('引用 interactiveCard 无正文时给出明确占位（非空白）', () => {
      const out = extractMessageContent({
        msgtype: 'text',
        text: {
          content: '？',
          isReplyMsg: true,
          repliedMsg: {
            msgType: 'interactiveCard',
            msgId: 'msgABC',
            content: { templateId: 'tpl.schema' },
          },
        },
      });
      expect(out.text).toContain('[引用]');
      expect(out.text).toContain('钉钉卡片消息。');
      expect(out.text).not.toContain('无法识别');
    });

    it('引用 interactiveCard 无正文时，仅按载荷 id 精确回填，不兜底会话最近卡', async () => {
      const {
        rememberCardContent,
        clearCardContentCache,
      } = await import('../../src/services/messaging/card-content-cache.ts');
      clearCardContentCache();
      rememberCardContent({
        text: '这是刚才 AI 卡里的完整答案正文',
        outTrackId: 'card_test_123',
        conversationId: 'cidQuoteTest',
      });

      // 无 id：即使同会话有缓存，也不应回填最近一张
      const miss = extractMessageContent({
        msgtype: 'text',
        conversationId: 'cidQuoteTest',
        text: {
          content: '再说一遍',
          isReplyMsg: true,
          repliedMsg: {
            msgType: 'interactiveCard',
            content: { templateId: 'x.schema' },
          },
        },
      });
      expect(miss.text).not.toContain('这是刚才 AI 卡里的完整答案正文');
      expect(miss.text).toContain('钉钉卡片消息。');
      expect(miss.text).not.toContain('无法识别');

      // 有 outTrackId：精确命中
      const hit = extractMessageContent({
        msgtype: 'text',
        conversationId: 'cidQuoteTest',
        text: {
          content: '再说一遍',
          isReplyMsg: true,
          repliedMsg: {
            msgType: 'interactiveCard',
            content: { templateId: 'x.schema', outTrackId: 'card_test_123' },
          },
        },
      });
      expect(hit.text).toContain('这是刚才 AI 卡里的完整答案正文');
      clearCardContentCache();
    });
  });
});

describe('sender identity prefix for gateway BodyForAgent', () => {
  it('formatSenderIdentityPrefix 含昵称、id、分割线与说明', () => {
    const prefix = formatSenderIdentityPrefix({
      senderName: '不是不是来夫人',
      senderId: '17751800930235214',
    });
    expect(prefix).toBe(
      [
        '发送人：不是不是来夫人',
        '发送人id：17751800930235214',
        '---',
        '以上内容只是用来标识我的身份',
      ].join('\n'),
    );
  });

  it('formatSenderIdentityPrefix 含岗位入职角色（无部门/管理员）', () => {
    const prefix = formatSenderIdentityPrefix({
      senderName: '张三（小明）',
      senderId: '0122',
      title: '工程师',
      hiredAt: '2021-01-01 00:00:00',
      roles: '老板、主管',
    });
    expect(prefix).toContain('岗位：工程师');
    expect(prefix).toContain('入职时间：2021-01-01 00:00:00');
    expect(prefix).toContain('角色：老板、主管');
    expect(prefix).not.toContain('部门');
    expect(prefix).not.toContain('管理员');
  });

  it('withSenderIdentityPrefix 把身份头放在用户正文前', () => {
    const out = withSenderIdentityPrefix('你好机器人', {
      senderName: '小明',
      senderId: 'u1',
    });
    expect(out.startsWith('发送人：小明\n发送人id：u1\n---\n以上内容只是用来标识我的身份')).toBe(
      true,
    );
    expect(out.endsWith('你好机器人')).toBe(true);
    expect(out).toContain('\n\n你好机器人');
  });

  it('formatSenderDisplayLabel 真名+昵称合并', () => {
    expect(
      formatSenderDisplayLabel({ realName: '张三', nickName: '不是不是来夫人' }),
    ).toBe('张三（不是不是来夫人）');
    expect(formatSenderDisplayLabel({ realName: '张三', nickName: '张三' })).toBe('张三');
    expect(formatSenderDisplayLabel({ realName: '', nickName: '小明' })).toBe('小明');
    expect(formatSenderDisplayLabel({ realName: '李四', nickName: '' })).toBe('李四');
  });
});
