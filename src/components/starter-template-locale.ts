import { STARTER_TEMPLATES } from "../server/content/starter-templates";
import type { ExploreTemplate } from "./content-api";
import type { Locale } from "./workspace-data";

type StarterCopy = Pick<ExploreTemplate, "title" | "description" | "category" | "definition">;

const persian: readonly StarterCopy[] = [
  {
    title: "تصویر شاخص محصول",
    description: "از تصویر مرجع محصول، یک تصویر تبلیغاتی حرفه‌ای بساز و سپس صحنه را بدون تغییر محصول اصلاح کن.",
    category: "تصویر",
    definition: { version: 1, inputs: [
      { key: "product", label: "محصول و جزئیات اصلی", type: "text", required: true },
      { key: "reference", label: "عکس مرجع محصول", type: "image", required: false },
      { key: "brand", label: "رنگ‌ها و قواعد بصری برند", type: "text", required: false }
    ], steps: [
      { id: "brief", title: "جهت‌گیری هنری", kind: "chat", modelId: "openrouter/auto", prompt: "برای {{product}} یک راهنمای هنری کوتاه بنویس. تصویر مرجع محصول و این قواعد برند را در نظر بگیر: {{brand}}. محیط، نور، زاویهٔ دوربین، پالت رنگ و جزئیاتی را که نباید تغییر کنند مشخص کن." },
      { id: "hero", title: "ساخت تصویر شاخص", kind: "image", prompt: "از {{product}} یک تصویر شاخص تبلیغاتی با کیفیت مجله‌ای بساز. اگر تصویر مرجع ضمیمه شده، شکل دقیق محصول، بسته‌بندی، لوگو و نوشته‌هایش را حفظ کن. نورپردازی سنجیده و ترکیب‌بندی تمیز داشته باش و از این نشانه‌های برند پیروی کن: {{brand}}. محصول اضافه یا متن ساختگی ایجاد نکن." },
      { id: "refine", title: "اصلاح صحنه", kind: "image", modelId: "fal-ai/qwen-image-edit", prompt: "با استفاده از تصویر قبلی به‌عنوان مرجع، فقط پس‌زمینه، نور و سایه‌ها را اصلاح کن. محصول، لوگو، برچسب، تناسب‌ها و زاویهٔ دوربین تغییر نکنند. این قواعد برند را رعایت کن: {{brand}}." }
    ] }
  },
  {
    title: "پرترهٔ یکدست",
    description: "یک مرجع برای شخصیت بساز و او را با حفظ ویژگی‌های شناخته‌شده در صحنه‌ای تازه قرار بده.",
    category: "تصویر",
    definition: { version: 1, inputs: [
      { key: "subject", label: "توصیف سوژه", type: "text", required: true },
      { key: "reference", label: "تصویر مرجع سوژه با رضایت او", type: "image", required: false },
      { key: "scene", label: "صحنه و پوشش تازه", type: "text", required: true }
    ], steps: [
      { id: "identity", title: "راهنمای شخصیت", kind: "chat", modelId: "openrouter/auto", prompt: "برای {{subject}} با استفاده از تصویر مرجع، اگر موجود است، راهنمای کوتاهی برای حفظ یکدستی ظاهر بنویس. ویژگی‌های ثابت چهره، مدل مو، سن ظاهری و نشانه‌های متمایز را ثبت کن. سپس صحنهٔ تازه را توصیف کن: {{scene}}." },
      { id: "anchor", title: "ساخت پرترهٔ مرجع", kind: "image", prompt: "پرتره‌ای طبیعی و دقیق از {{subject}} در {{scene}} بساز. ویژگی‌های اصلی چهره، مدل مو و سن ظاهری را مطابق مرجع حفظ کن. نور و آناتومی واقع‌گرایانه باشد؛ فرد یا متن اضافه ایجاد نکن." },
      { id: "variation", title: "ساخت نسخهٔ هماهنگ", kind: "image", modelId: "fal-ai/qwen-image-edit", prompt: "پرترهٔ ساخته‌شده را مرجع قرار بده. ژست و کادربندی را برای {{scene}} تغییر بده، اما هویت سوژه، مدل مو، جزئیات لباس و سبک عکاسی را حفظ کن." }
    ] }
  },
  {
    title: "صحنهٔ فیلم کوتاه",
    description: "یک نما را برنامه‌ریزی کن، فریم اصلی را بساز و با زمان متناسب با مدل به ویدیو تبدیلش کن.",
    category: "ویدیو",
    definition: { version: 1, inputs: [
      { key: "story", label: "داستان و سوژه", type: "text", required: true },
      { key: "style", label: "سبک بصری", type: "text", required: false },
      { key: "keyframe", label: "فریم نخست اختیاری", type: "image", required: false }
    ], steps: [
      { id: "storyboard", title: "نوشتن برنامهٔ نما", kind: "chat", modelId: "openrouter/auto", prompt: "برای {{story}} یک نمای سینمایی ۴ تا ۸ ثانیه‌ای با این سبک طراحی کن: {{style}}. سوژه، فریم آغازین، حرکت دوربین، کنش، فریم پایانی و صدا را مشخص کن. کنش باید در مدت‌زمان مدل انتخاب‌شده قابل اجرا باشد." },
      { id: "frame", title: "ساخت فریم اصلی", kind: "image", prompt: "برای {{story}} یک فریم آغازین سینمایی بساز. سبک بصری: {{style}}. جای سوژه، محیط و نور مناسب برای آغاز نمای متحرک کوتاه روشن باشد. زیرنویس یا واترمارک نگذار." },
      { id: "motion", title: "متحرک‌سازی نما", kind: "video", modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "فریم نخست ارائه‌شده را به یک نمای فیلم کوتاه و پیوسته برای {{story}} تبدیل کن. پیوستگی سوژه و صحنه را حفظ کن. حرکت دوربین و کنش کنترل‌شده و خوانا باشند و پایان مشخصی داشته باشند. سبک بصری: {{style}}." }
    ] }
  },
  {
    title: "گویندگی",
    description: "متن را برای گفتار روان آماده کن و با زبان و ریتم درخواستی گویندگی بساز.",
    category: "صدا",
    definition: { version: 1, inputs: [
      { key: "script", label: "متن اولیه", type: "text", required: true },
      { key: "language", label: "زبان", type: "text", required: true },
      { key: "delivery", label: "راهنمای صدا و شیوهٔ بیان", type: "text", required: false }
    ], steps: [
      { id: "polish", title: "آماده‌سازی متن گفتاری", kind: "chat", modelId: "openrouter/auto", prompt: "{{script}} را برای گویندگی طبیعی به زبان {{language}} بازنویسی کن. معنا و نام‌ها را دقیق نگه دار. با نشانه‌گذاری، ریتم گفتار را روشن کن و متن گفتاری را از یادداشت‌های تولید جدا نگه دار. شیوهٔ بیان: {{delivery}}." },
      { id: "speak", title: "ساخت گویندگی", kind: "audio", modelId: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "{{script}}" },
      { id: "review", title: "بازبینی تلفظ", kind: "chat", modelId: "openrouter/auto", prompt: "این متن گویندگی را از نظر تلفظ یا ریتم احتمالی در زبان {{language}} بررسی کن. فقط کمترین تغییر لازم برای اجرای بعدی را پیشنهاد بده. راهنمای صدا: {{delivery}}. متن: {{script}}" }
    ] }
  },
  {
    title: "ویدیوی معرفی اجتماعی",
    description: "برای معرفی در شبکه‌های اجتماعی، شروع جذاب، تصویر، ویدیوی متحرک و گویندگی بساز.",
    category: "ویدیو",
    definition: { version: 1, inputs: [
      { key: "offer", label: "محصول یا خبر", type: "text", required: true },
      { key: "audience", label: "مخاطب و پلتفرم", type: "text", required: true },
      { key: "brand", label: "لحن و قواعد بصری برند", type: "text", required: false },
      { key: "reference", label: "تصویر مرجع اختیاری محصول", type: "image", required: false }
    ], steps: [
      { id: "hook", title: "نوشتن شروع جذاب", kind: "chat", modelId: "openrouter/auto", prompt: "برای {{offer}} و مخاطبان {{audience}} یک شروع کوتاه و مشخص برای ویدیوی اجتماعی بنویس. از این لحن برند استفاده کن: {{brand}}. یک کنش بصری روشن و دعوت کوتاه به اقدام داشته باشد. ادعای بی‌پشتوانه نکن." },
      { id: "cover", title: "ساخت فریم معرفی", kind: "image", prompt: "برای {{offer}} و {{audience}} یک تصویر عمودی چشمگیر اما تمیز بساز. این قواعد برند را رعایت کن: {{brand}}. اگر تصویر مرجع محصول ضمیمه شده، شکل واقعی، برچسب و لوگوی آن را حفظ کن. برای افزودن نوشته در مرحلهٔ بعد فضای خالی بگذار؛ متن داخل تصویر نساز." },
      { id: "clip", title: "متحرک‌سازی ویدیو", kind: "video", modelId: "fal-ai/veo3.1/fast/image-to-video", prompt: "از فریم معرفی ارائه‌شده، برای {{offer}} یک ویدیوی کوتاه عمودی بساز. با تصویری جذاب شروع کن، حرکت روان و خوانا داشته باش، محصول مرجع را یکدست نگه دار و با فریمی مناسب برای دعوت به اقدام تمام کن. جهت‌گیری برند: {{brand}}." },
      { id: "voice-script", title: "نوشتن متن گویندگی", kind: "chat", modelId: "openrouter/auto", prompt: "فقط کلمات گفتاری یک گویندگی کوتاه برای معرفی {{offer}} به {{audience}} را بنویس. این لحن برند را رعایت کن: {{brand}}. از شروع جذاب قبلی استفاده کن و یک یا دو جمله بدون دستور، برچسب یا گیومه برگردان." },
      { id: "voice", title: "افزودن گویندگی", kind: "audio", modelId: "fal-ai/elevenlabs/tts/eleven-v3", prompt: "{{previous}}" }
    ] }
  }
];

/** Translate only untouched built-in recipes; user edits remain exactly as stored. */
export function localizeStarterTemplate(template: ExploreTemplate, locale: Locale): ExploreTemplate {
  if (locale !== "fa") return template;
  const index = STARTER_TEMPLATES.findIndex(starter =>
    starter.title === template.title && starter.description === template.description &&
    starter.category === template.category &&
    starter.definition.version === template.definition.version &&
    starter.definition.inputs.length === template.definition.inputs.length &&
    starter.definition.inputs.every((input, position) => {
      const current = template.definition.inputs[position];
      return input.key === current.key && input.label === current.label &&
        input.type === current.type && input.required === current.required;
    }) &&
    starter.definition.steps.length === template.definition.steps.length &&
    starter.definition.steps.every((step, position) => {
      const current = template.definition.steps[position];
      return step.id === current.id && step.title === current.title &&
        step.kind === current.kind && step.prompt === current.prompt &&
        (step.modelId ?? null) === (current.modelId ?? null);
    }));
  if (index < 0) return template;
  return { ...template, ...persian[index] };
}
