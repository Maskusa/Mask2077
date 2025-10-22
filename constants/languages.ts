export interface LanguageInfo {
  iso2: string;
  iso3: string;
  iso3b: string;
  iso3t: string;
  englishName: string;
  nativeName: string;
}

type LanguageLookup = Record<string, LanguageInfo>;

const LANGUAGE_DEFINITIONS: string[] = [
  "ID_Lg_Afrikaans.af.afr.afr.afr.Afrikaans.Afrikaans",
  "ID_Lg_Amharic.am.amh.amh.amh.Amharic.Amharic  አማርኛ",
  "ID_Lg_Arabic.ar.ara.ara.ara.Arabic.عربي",
  "ID_Lg_Azerbaijani.az.aze.aze.aze.Azerbaijani.azərbaycan dili",
  "ID_Lg_Belarusian.be.bel.bel.bel.Belarusian.Беларуская мова",
  "ID_Lg_Bulgarian.bg.bul.bul.bul.Bulgarian.Български език",
  "ID_Lg_Bengali.bn.ben.ben.ben.Bengali.বাংলা",
  "ID_Lg_Bosnian.bs.bos.bos.bos.Bosnian.bosanski jezik",
  "ID_Lg_Catalan.ca.cat.cat.cat.Catalan.català, valencià",
  "ID_Lg_Corsican.co.cos.cos.cos.Corsican.corsu, lingua corsa",
  "ID_Lg_Czech.cs.ces.cze.ces.Czech.čeština, český jazyk",
  "ID_Lg_Welsh.cy.cym.wel.cym.Welsh.Cymraeg",
  "ID_Lg_Danish.da.dan.dan.dan.Danish.Dansk",
  "ID_Lg_German.de.deu.ger.deu.German.Deutsch",
  "ID_Lg_Greek.el.ell.gre.ell.Greek.ελληνικά",
  "ID_Lg_English.en.eng.eng.eng.English.English",
  "ID_Lg_Esperanto.eo.epo.epo.epo.Esperanto.Esperanto",
  "ID_Lg_Spanish.es.spa.spa.spa.Spanish.Español",
  "ID_Lg_Estonian.et.est.est.est.Estonian.eesti, eesti keel",
  "ID_Lg_Basque.eu.eus.baq.eus.Basque.euskara, euskera",
  "ID_Lg_Persian.fa.fas.per.fas.Persian.یسراف",
  "ID_Lg_Finnish.fi.fin.fin.fin.Finnish.suomi, suomen kieli",
  "ID_Lg_French.fr.fra.fre.fra.French.Français, langue française",
  "ID_Lg_WesternFrisian.fy.fry.fry.fry.WesternFrisian.Frysk",
  "ID_Lg_Irish.ga.gle.gle.gle.Irish.Gaeilge",
  "ID_Lg_Gaelic.gd.gla.gla.gla.Gaelic.Gàidhlig",
  "ID_Lg_Galician.gl.glg.glg.glg.Galician.Galego",
  "ID_Lg_Gujarati.gu.guj.guj.guj.Gujarati.ગુજરાતી",
  "ID_Lg_Hausa.ha.hau.hau.hau.Hausa.(Hausa) هَوُسَ",
  "ID_Lg_Hebrew.iw.heb.heb.heb.Hebrew.עִברִית",
  "ID_Lg_Hindi.hi.hin.hin.hin.Hindi.हिन्दी, हिंदी",
  "ID_Lg_Philippine.tl.fil.fil.fil.Philippine.Pilipino",
  "ID_Lg_Croatian.hr.hrv.hrv.hrv.Croatian.Hrvatski jezik",
  "ID_Lg_Haitian.ht.hat.hat.hat.Haitian.Kreyòl ayisyen",
  "ID_Lg_Hungarian.hu.hun.hun.hun.Hungarian.Magyar",
  "ID_Lg_Armenian.hy.hye.arm.hye.Armenian.Armenian",
  "ID_Lg_Indonesian.id.ind.ind.ind.Indonesian.Bahasa Indonesia",
  "ID_Lg_Igbo.ig.ibo.ibo.ibo.Igbo.Asụsụ Igbo",
  "ID_Lg_Icelandic.is.isl.ice.isl.Icelandic.Íslenska",
  "ID_Lg_Italian.it.ita.ita.ita.Italian.Italiano",
  "ID_Lg_Japanese.ja.jpn.jpn.jpn.Japanese.日本語 (にほんご)",
  "ID_Lg_Javanese.jv.jav.jav.jav.Javanese.ꦧꦱꦗꦮ, Basa Jawa",
  "ID_Lg_Georgian.ka.kat.geo.kat.Georgian.Georgian",
  "ID_Lg_Kazakh.kk.kaz.kaz.kaz.Kazakh.қазақ тілі",
  "ID_Lg_CentralKhmer.km.khm.khm.khm.CentralKhmer.CentralKhmer",
  "ID_Lg_Kannada.kn.kan.kan.kan.Kannada.ಕನ್ನಡ",
  "ID_Lg_Korean.ko.kor.kor.kor.Korean.한국어",
  "ID_Lg_Kurdish.ku.kur.kur.kur.Kurdish.Kurdî, کوردی‎",
  "ID_Lg_Kirghiz.ky.kir.kir.kir.Kirghiz.Кыргызча, Кыргыз тили",
  "ID_Lg_Latin.la.lat.lat.lat.Latin.latine, lingua latina",
  "ID_Lg_Luxembourgish.lb.ltz.ltz.ltz.Luxembourgish.Lëtzebuergesch",
  "ID_Lg_Lao.lo.lao.lao.lao.Lao.ພາສາລາວ",
  "ID_Lg_Lithuanian.lt.lit.lit.lit.Lithuanian.lietuvių kalba",
  "ID_Lg_Latvian.lv.lav.lav.lav.Latvian.latviešu valoda",
  "ID_Lg_Malagasy.mg.mlg.mlg.mlg.Malagasy.fiteny malagasy",
  "ID_Lg_Maori.mi.mri.mao.mri.Maori.te reo Māori",
  "ID_Lg_Macedonian.mk.mkd.mac.mkd.Macedonian.македонски јазик",
  "ID_Lg_Malayalam.ml.mal.mal.mal.Malayalam.മലയാളം",
  "ID_Lg_Mongolian.mn.mon.mon.mon.Mongolian.Монгол хэл",
  "ID_Lg_Marathi.mr.mar.mar.mar.Marathi.मराठी",
  "ID_Lg_Malay.ms.msa.may.msa.Malay.Bahasa Melayu, بهاس ملايو‎",
  "ID_Lg_Maltese.mt.mlt.mlt.mlt.Maltese.Malti",
  "ID_Lg_Burmese.my.mya.bur.mya.Burmese.Burmese",
  "ID_Lg_Nepali.ne.nep.nep.nep.Nepali.नेपाली",
  "ID_Lg_Dutch.nl.nld.dut.nld.Dutch.Nederlands, Vlaams",
  "ID_Lg_Norwegian.no.nor.nor.nor.Norwegian.Norsk",
  "ID_Lg_Chichewa.ny.nya.nya.nya.Chichewa.chiCheŵa, chinyanja",
  "ID_Lg_Punjabi.pa.pan.pan.pan.Punjabi.ਪੰਜਾਬੀ, پنجابی‎",
  "ID_Lg_Polish.pl.pol.pol.pol.Polish.język polski, polszczyzna",
  "ID_Lg_Pashto.ps.pus.pus.pus.Pashto.وتښپ",
  "ID_Lg_Portuguese.pt.por.por.por.Portuguese.Português",
  "ID_Lg_Romanian.ro.ron.rum.ron.Romanian.Română",
  "ID_Lg_Russian.ru.rus.rus.rus.Russian.Русский",
  "ID_Lg_Sindhi.sd.snd.snd.snd.Sindhi.सिन्धी, ‎یھدنس ،يڌنس",
  "ID_Lg_SinhalaSinhalese.si.sin.sin.sin.SinhalaSinhalese.සිංහල",
  "ID_Lg_Slovak.sk.slk.slo.slk.Slovak.Slovenčina, Slovenský Jazyk",
  "ID_Lg_Slovenian.sl.slv.slv.slv.Slovenian.Slovenski Jezik, Slovenščina",
  "ID_Lg_Samoan.sm.smo.smo.smo.Samoan.gagana fa'a Samoa",
  "ID_Lg_Shona.sn.sna.sna.sna.Shona.chiShona",
  "ID_Lg_Somali.so.som.som.som.Somali.Soomaaliga, af Soomaali",
  "ID_Lg_Albanian.sq.sqi.alb.sqi.Albanian.Shqip",
  "ID_Lg_Serbian.sr.srp.srp.srp.Serbian.Српски језик",
  "ID_Lg_SouthernSotho.st.sot.sot.sot.SouthernSotho.Sesotho",
  "ID_Lg_Sundanese.su.sun.sun.sun.Sundanese.Basa Sunda",
  "ID_Lg_Swedish.sv.swe.swe.swe.Swedish.Svenska",
  "ID_Lg_Swahili.sw.swa.swa.swa.Swahili.Kiswahili",
  "ID_Lg_Tamil.ta.tam.tam.tam.Tamil.தமிழ்",
  "ID_Lg_Telugu.te.tel.tel.tel.Telugu.తెలుగు",
  "ID_Lg_Tajik.tg.tgk.tgk.tgk.Tajik.тоҷикӣ, toçikī, تاجیکی‎",
  "ID_Lg_Thai.th.tha.tha.tha.Thai.ไทย",
  "ID_Lg_Turkish.tr.tur.tur.tur.Turkish.Türkçe",
  "ID_Lg_Ukrainian.uk.ukr.ukr.ukr.Ukrainian.Українська",
  "ID_Lg_Urdu.ur.urd.urd.urd.Urdu.ودرا",
  "ID_Lg_Uzbek.uz.uzb.uzb.uzb.Uzbek.Oʻzbek, Ўзбек, أۇزبېك‎",
  "ID_Lg_Vietnamese.vi.vie.vie.vie.Vietnamese.Tiếng Việt",
  "ID_Lg_Xhosa.xh.xho.xho.xho.Xhosa.isiXhosa",
  "ID_Lg_Yiddish.yi.yid.yid.yid.Yiddish.שידִיי",
  "ID_Lg_Chinese.zh.zho.chi.zho.Chinese.中文 (Zhōngwén), 汉语, 漢語",
  "ID_Lg_Zulu.zu.zul.zul.zul.Zulu.isiZulu"
];

const sanitizeKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s]+/g, '');

const compactKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_\-]/g, '');

const normalizedKey = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_]+/g, '-');

const LANGUAGE_LOOKUP: LanguageLookup = {};

const registerKeys = (info: LanguageInfo, ...keys: (string | undefined)[]) => {
  keys
    .filter((key): key is string => Boolean(key && key.trim().length > 0))
    .forEach((key) => {
      const normalized = normalizedKey(key);
      const compact = compactKey(key);
      LANGUAGE_LOOKUP[normalized] = info;
      LANGUAGE_LOOKUP[compact] = info;
      const hyphenSplit = normalized.split('-');
      if (hyphenSplit.length > 0) {
        LANGUAGE_LOOKUP[hyphenSplit[0]] = info;
      }
    });
};

LANGUAGE_DEFINITIONS.forEach((definition) => {
  const parts = definition.split('.');
  if (parts.length < 7) {
    return;
  }
  const [, iso2, iso3, iso3b, iso3t, englishName, nativeName] = parts;
  const info: LanguageInfo = {
    iso2: iso2.toLowerCase(),
    iso3: iso3.toLowerCase(),
    iso3b: iso3b.toLowerCase(),
    iso3t: iso3t.toLowerCase(),
    englishName,
    nativeName,
  };
  registerKeys(info, iso2, iso3, iso3b, iso3t, englishName, nativeName);
  registerKeys(info, `${iso2}-${iso2}`, `${iso3}-${iso3}`, `${iso2}_${iso2}`, `${iso3}_${iso3}`);
});

export const normalizeLanguageCode = (input?: string | null): LanguageInfo | undefined => {
  if (!input) {
    return undefined;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = normalizedKey(trimmed);
  if (LANGUAGE_LOOKUP[normalized]) {
    return LANGUAGE_LOOKUP[normalized];
  }
  const compact = compactKey(trimmed);
  if (LANGUAGE_LOOKUP[compact]) {
    return LANGUAGE_LOOKUP[compact];
  }
  const parts = normalized.split('-');
  if (parts.length > 0) {
    const primary = parts[0];
    if (LANGUAGE_LOOKUP[primary]) {
      return LANGUAGE_LOOKUP[primary];
    }
  }
  return undefined;
};

export const formatLanguageLabel = (info: LanguageInfo | undefined, fallback: string): string => {
  if (!info) {
    return fallback;
  }
  if (info.nativeName && info.nativeName.toLowerCase() !== info.englishName.toLowerCase()) {
    return `${info.englishName} • ${info.nativeName}`;
  }
  return info.englishName;
};

