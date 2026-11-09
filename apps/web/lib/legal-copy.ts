/**
 * الصفحات القانونية — الشروط، والخصوصية، والاسترجاع.
 *
 * كلّ جملةٍ هنا تصف ما يفعله الكود فعلاً: ما يُجمع، وأين يُحفظ، وكم يبقى.
 * إن تغيّر الكود تغيّرت هذه معه — وعدٌ في صفحةٍ قانونية لا يفي به الكود
 * أسوأ من غيابه.
 */

export type LegalKind = 'terms' | 'privacy' | 'refund';

export interface LegalSection {
  h: string;
  p: readonly string[];
}

export interface LegalDoc {
  title: string;
  updated: string;
  sections: readonly LegalSection[];
}

export const SUPPORT_EMAIL = 'support@aitchek.online';

export const legalNav = {
  ar: { terms: 'الشروط', privacy: 'الخصوصية', refund: 'الاسترجاع', contact: 'تواصل معنا', back: 'العودة إلى الرئيسية' },
  en: { terms: 'Terms', privacy: 'Privacy', refund: 'Refunds', contact: 'Contact', back: 'Back to home' },
} as const;

const AR_UPDATED = 'آخر تحديث: 9 نوفمبر 2026';
const EN_UPDATED = 'Last updated: November 9, 2026';

export const legal: Record<'ar' | 'en', Record<LegalKind, LegalDoc>> = {
  ar: {
    terms: {
      title: 'شروط الاستخدام',
      updated: AR_UPDATED,
      sections: [
        {
          h: 'الخدمة',
          p: [
            'وكيل تشيك (aitchek.online) أداةٌ للمتاجر الإلكترونية: تسأل محرّكات الذكاء الاصطناعي — مثل ChatGPT وGoogle AI Mode — أسئلةً يطرحها المشترون، وتعرض الإجابة كما ظهرت حرفياً، ومن ذُكر فيها، وقواعد تقنية فُحصت على صفحات المتجر العامة مع إصلاحاتها.',
            'باستخدامك الموقع أو اشتراكك فيه توافق على هذه الشروط.',
          ],
        },
        {
          h: 'ما لا نَعِد به',
          p: [
            'إجابات محرّكات الذكاء الاصطناعي تتغيّر من يومٍ لآخر ومن مستخدمٍ لآخر. نعرض ما قيس وقت الفحص، ولا نضمن ظهور متجرك في أيّ إجابة، ولا ترتيباً، ولا مبيعات.',
            'الإصلاحات المقترحة إرشادية؛ تطبيقها على متجرك مسؤوليتك، وننصح بمراجعتها قبل النشر.',
          ],
        },
        {
          h: 'الاستخدام المقبول',
          p: [
            'لا تستعمل الخدمة لإرهاق مواقع الآخرين، ولا لتجاوز حدود الاستخدام المجانية بطرقٍ آلية، ولا لأيّ غرضٍ مخالفٍ للقانون. نفحص الصفحات العامة فقط، ولا ندخل إلى أيّ حسابٍ أو منطقةٍ محمية.',
            'يحقّ لنا تقييد الوصول أو إيقافه عند إساءة الاستخدام.',
          ],
        },
        {
          h: 'الاشتراك والدفع',
          p: [
            'الاشتراك الشهري للمتابعة الأسبوعية بـ39 دولاراً، وأول 14 يوماً مجاناً. تتولّى Lemon Squeezy عملية الدفع بصفتها البائع المسجّل (Merchant of Record)، وتحتسب الضرائب المستحقّة وتصدر الإيصالات.',
            'يتجدّد الاشتراك تلقائياً كلّ شهر، ويمكنك إلغاؤه في أيّ وقت من رابط الإدارة في إيصال Lemon Squeezy؛ وتبقى الخدمة متاحةً حتى نهاية الفترة المدفوعة.',
          ],
        },
        {
          h: 'الملكية',
          p: ['تقاريرك لك، ولك أن تشاركها. والأداة وتصميمها وكودها ملكٌ لوكيل تشيك.'],
        },
        {
          h: 'المسؤولية',
          p: [
            'تُقدَّم الخدمة «كما هي». لا نتحمّل خسائر غير مباشرة ناتجة عن استعمالها، وأقصى مسؤوليتنا ما دفعته لنا خلال الأشهر الثلاثة السابقة للمطالبة.',
          ],
        },
        {
          h: 'التعديلات والتواصل',
          p: [
            'قد نعدّل هذه الشروط، ونذكر تاريخ آخر تحديثٍ أعلى الصفحة. وتخضع هذه الشروط لقوانين المملكة المغربية.',
            `لأيّ سؤال: ${SUPPORT_EMAIL}`,
          ],
        },
      ],
    },
    privacy: {
      title: 'سياسة الخصوصية',
      updated: AR_UPDATED,
      sections: [
        {
          h: 'ما نجمعه',
          p: [
            'نطاق المتجر الذي تفحصه، وما نقرؤه من صفحاته العامة، ونتيجة الفحص: الأسئلة، وإجابات المحرّكات، والقواعد التقنية.',
            'عنوان IP الخاص بك لا يُحفظ كما هو: نحفظ بصمةً مشفّرةً منه (SHA-256 مع مِلح سرّي) لتطبيق حدّ الفحوصات المجانية فقط.',
            'عند الاشتراك: بريدك الإلكتروني ولغة الاشتراك، كما ترسلها Lemon Squeezy، لنرسل إليك النشرة الأسبوعية. لا نحفظ اسماً ولا عنواناً ولا بيانات بطاقة — الدفع كلّه عند Lemon Squeezy.',
          ],
        },
        {
          h: 'كم نحتفظ بها',
          p: [
            'نتيجة الفحص في الذاكرة المؤقتة يومين، ثم في أرشيفنا ليبقى رابط تقريرك صالحاً. وبيانات الاشتراك ما دام الاشتراك قائماً.',
            `لحذف تقاريرك أو بياناتك راسلنا على ${SUPPORT_EMAIL}.`,
          ],
        },
        {
          h: 'من يعالجها معنا',
          p: [
            'OpenAI (أسئلة ChatGPT)، وDataForSEO (إجابات Google)، وVercel (الاستضافة والإحصاءات)، وUpstash (الذاكرة المؤقتة)، وNeon (قاعدة البيانات)، وCloudflare Turnstile (التحقّق من أنك لست برنامجاً)، وResend (إرسال البريد)، وLemon Squeezy (الدفع).',
            'نرسل إلى محرّكات الذكاء الاصطناعي أسئلةً عن متجرك وفئته وبلده، لا بياناتك الشخصية.',
          ],
        },
        {
          h: 'الإحصاءات وملفّات الارتباط',
          p: [
            'نستعمل Vercel Analytics، وهي لا تستعمل ملفّات ارتباط ولا تتبّعك بين المواقع. ونحفظ في متصفّحك اختيارك للوضع الداكن أو الفاتح وتقليل الحركة فقط.',
          ],
        },
        {
          h: 'حقوقك',
          p: [`يحقّ لك الاطلاع على بياناتك وتصحيحها وحذفها. راسلنا على ${SUPPORT_EMAIL} ونردّ خلال 30 يوماً.`],
        },
      ],
    },
    refund: {
      title: 'سياسة الاسترجاع',
      updated: AR_UPDATED,
      sections: [
        {
          h: 'التجربة المجانية',
          p: ['أول 14 يوماً من الاشتراك مجانية. ألغِ قبل نهايتها ولن يُخصم منك شيء.'],
        },
        {
          h: 'استرجاع أوّل دفعة',
          p: [
            `إن دُفع اشتراكك ولم تجد فيه ما توقّعت، راسلنا على ${SUPPORT_EMAIL} خلال 14 يوماً من أوّل خصم، ونعيد المبلغ كاملاً بلا أسئلة.`,
          ],
        },
        {
          h: 'التجديدات',
          p: [
            'يمكنك إلغاء الاشتراك في أيّ وقت، وتبقى المتابعة حتى نهاية الشهر المدفوع. لا نعيد جزءاً من شهرٍ بدأ، إلا إن تعطّلت الخدمة من جهتنا ولم تصلك نشرة ذلك الشهر.',
          ],
        },
        {
          h: 'كيف يتمّ الاسترجاع',
          p: ['تتمّ المبالغ المسترجعة عبر Lemon Squeezy إلى وسيلة الدفع نفسها، وقد تستغرق أياماً حسب البنك.'],
        },
      ],
    },
  },
  en: {
    terms: {
      title: 'Terms of Service',
      updated: EN_UPDATED,
      sections: [
        {
          h: 'The service',
          p: [
            'WakeelCheck (aitchek.online) is a tool for online stores. It asks AI assistants — such as ChatGPT and Google AI Mode — the questions shoppers ask, shows the answer exactly as it appeared, who was named in it, and technical checks run on the store’s public pages, with their fixes.',
            'By using or subscribing to the site, you agree to these terms.',
          ],
        },
        {
          h: 'What we do not promise',
          p: [
            'AI answers change from day to day and from user to user. We show what was measured at scan time. We do not guarantee that your store will appear in any answer, any ranking, or any sales.',
            'Suggested fixes are guidance; applying them to your store is your responsibility, and we recommend reviewing them before publishing.',
          ],
        },
        {
          h: 'Acceptable use',
          p: [
            'Do not use the service to overload other websites, to bypass the free usage limits by automated means, or for any unlawful purpose. We read public pages only and never log in to any account or protected area.',
            'We may restrict or suspend access in case of abuse.',
          ],
        },
        {
          h: 'Subscription and payment',
          p: [
            'Weekly monitoring costs $39 per month, with the first 14 days free. Payments are handled by Lemon Squeezy as Merchant of Record, which calculates applicable taxes and issues receipts.',
            'The subscription renews monthly. You can cancel at any time from the manage link in your Lemon Squeezy receipt; the service stays active until the end of the paid period.',
          ],
        },
        {
          h: 'Ownership',
          p: ['Your reports are yours to share. The tool, its design and its code belong to WakeelCheck.'],
        },
        {
          h: 'Liability',
          p: [
            'The service is provided “as is”. We are not liable for indirect losses arising from its use, and our total liability is limited to what you paid us in the three months before the claim.',
          ],
        },
        {
          h: 'Changes and contact',
          p: [
            'We may update these terms and will show the date of the last update at the top of this page. These terms are governed by the laws of the Kingdom of Morocco.',
            `Questions: ${SUPPORT_EMAIL}`,
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      updated: EN_UPDATED,
      sections: [
        {
          h: 'What we collect',
          p: [
            'The store domain you scan, what we read from its public pages, and the scan result: questions, engine answers, and technical checks.',
            'Your IP address is not stored as is: we keep a one-way hash of it (SHA-256 with a secret salt), only to apply the free scan limit.',
            'When you subscribe: your email and subscription language, as sent by Lemon Squeezy, so we can send you the weekly digest. We store no name, address or card details — all payment data stays with Lemon Squeezy.',
          ],
        },
        {
          h: 'How long we keep it',
          p: [
            'Scan results stay in a short-term cache for two days, then in our archive so your report link keeps working. Subscription data is kept while the subscription is active.',
            `To delete your reports or data, email ${SUPPORT_EMAIL}.`,
          ],
        },
        {
          h: 'Who processes it with us',
          p: [
            'OpenAI (ChatGPT questions), DataForSEO (Google answers), Vercel (hosting and analytics), Upstash (cache), Neon (database), Cloudflare Turnstile (bot check), Resend (email delivery), and Lemon Squeezy (payments).',
            'We send AI engines questions about your store, its category and its country — not your personal data.',
          ],
        },
        {
          h: 'Analytics and cookies',
          p: [
            'We use Vercel Analytics, which uses no cookies and does not track you across sites. Your browser stores only your dark/light and reduced-motion preferences.',
          ],
        },
        {
          h: 'Your rights',
          p: [`You can access, correct or delete your data. Email ${SUPPORT_EMAIL} and we will reply within 30 days.`],
        },
      ],
    },
    refund: {
      title: 'Refund Policy',
      updated: EN_UPDATED,
      sections: [
        {
          h: 'Free trial',
          p: ['The first 14 days of your subscription are free. Cancel before they end and you will not be charged.'],
        },
        {
          h: 'Refund of your first payment',
          p: [
            `If you were charged and the service is not what you expected, email ${SUPPORT_EMAIL} within 14 days of your first charge and we will refund it in full, no questions asked.`,
          ],
        },
        {
          h: 'Renewals',
          p: [
            'You can cancel at any time and monitoring continues until the end of the paid month. We do not refund part of a month already started, unless the service failed on our side and you received no digest that month.',
          ],
        },
        {
          h: 'How refunds are made',
          p: ['Refunds are issued through Lemon Squeezy to the original payment method and may take a few days depending on your bank.'],
        },
      ],
    },
  },
};
