# Modern HN

[Hacker News resmi API'si](https://github.com/HackerNews/API) ile beslenen, okunabilirlik odaklı bir Hacker News arayüzü. Derleme adımı yok, bağımlılık yok — saf HTML/CSS/JS. GitHub Pages'e olduğu gibi yüklenir.

## Özellikler

- **Canlı veri** — tüm içerik `hacker-news.firebaseio.com/v0` üzerinden anlık çekilir; önbellek kısa ömürlüdür (liste 60 sn, içerik 5 dk).
- **Akışlar** — Popüler, Yeni, En İyi, Ask HN, Show HN, İşler + yerel "Kayıtlar" listesi.
- **Zengin liste düzeni** — düz metin yığını yerine her satırın kimliği var:
  - *kaynak çapası*: domain favicon'u; yüklenemezse domain adından türeyen kararlı renkli monogram,
  - *kaynak satırı*: domain · zaman · yazar,
  - *ilgi ısısı*: saat başına puan (`sakin` → `çok canlı`) küçük bir çubukla,
  - *bağlam alıntısı*: metin gönderilerinde gönderinin kendi metni, bağlantı gönderilerinde en üst yorumdan iki satırlık alıntı — böylece tıklamadan önce tartışmanın nereye gittiği görülür.
- **Yeni gönderi bildirimi** — açık sekmede akış 90 saniyede bir kontrol edilir, yenilik varsa üstte uyarı çıkar.
- **Yeni yorum takibi** — her gönderi için son okuma zamanı ve o andaki yorum sayısı saklanır:
  - akışta ziyaret ettiğin gönderilerde `+N yeni` rozeti,
  - iş parçacığında son okumandan sonra yazılan yorumlarda `yeni` etiketi, vurgulu yazar adı ve sol kenar çizgisi,
  - `n` / `p` ile yalnızca yeni yorumlar arasında gezinme (yeni yoksa üst düzey yorumlar arasında),
  - gönderiyi paylaşan kişinin yorumlarında `OP` rozeti.
- **Canlı iş parçacığı** — açık gönderi sayfası 60 saniyede bir yoklanır; yorum sayısı arttıysa "N yeni yorum geldi — Getir" şeridi çıkar, tıklayınca ağaç tazelenir ve gelenler `yeni` olarak işaretli gelir.
- **Okunabilir yorum ağacı** — katlanabilir başlıklar, derinlik çizgileri, ayarlanabilir satır genişliği, parti parti yükleme.
- **İş parçacığı denetimleri** — hepsi yüklü ağaç üzerinde çalışır, ek istek yapmaz:
  - üst düzey yorumları *HN sırası* / *en yeni* / *en çok yanıt* diye sıralama,
  - `f` ile yorum içi arama: eşleşmeler ve üst zincirleri kalır, gerisi süzülür, katlanmış dallar kendiliğinden açılır, `Enter` / `Shift+Enter` eşleşmeler arasında gezer,
  - hepsini katla / aç.
- **Yanıt dalı görünümü** — yorumların yanındaki `#` bağlantısı artık HN'ye değil uygulama içindeki `#/item/<yorum>` adresine gider: dal başlık olur, üstünde kök gönderiye çıkan bir iz durur, OP rozeti kökün yazarına göre hesaplanır.
- **Anketler** — `poll` gönderilerinde seçenekler (`parts` → `pollopt`) çekilir; her seçenek oy sayısı, toplam içindeki yüzdesi ve en yüksek seçeneğe göre ölçeklenmiş bir çubukla gösterilir.
- **Okuma ayarları** (`,`) — yazı boyutu (%85–150), satır genişliği (dar / orta / geniş), yoğunluk (rahat / sıkışık) ve yazı tipi (sans / serif). Ayarlar kök öğeye tasarım belirteci olarak yazılır, `localStorage`'da saklanır.
- **Paylaşım** — Web Share API varsa sistem paylaşım sayfası, yoksa panoya kopyalama. Paylaşılan adres her zaman dışarıdan açılabilen bir adrestir: bağlantı gönderilerinde makale, metin gönderisi/anket/yorumda HN sayfası.
- **Arama** — [HN Search (Algolia) API](https://hn.algolia.com/api) ile gönderi/yorum araması, ilgi veya tarih sıralaması.
- **Tema** — sistem / açık / koyu; tercih `localStorage`'da saklanır.
- **Okundu takibi ve kaydetme** — tarayıcıda yerel tutulur, hesap gerekmez.
- **Klavye kısayolları** — `j` `k` gezinme, `Enter`/`o` aç, `c` yorumlar, `n` `p` yeni yorumlar, `t` çevir, `s` kaydet, `Shift+s` paylaş, `f` yorumlarda ara, `,` okuma ayarları, `/` arama, `d` tema, `g` başa dön, `?` yardım.
- Erişilebilirlik: atlama bağlantısı, odak halkaları, `aria` etiketleri, `prefers-reduced-motion` desteği.

## Ayarlanabilir noktalar

- **Alıntı önizlemesi** gönderi başına 1 ek istek demektir; yalnızca kart ekrana girdiğinde (IntersectionObserver) çekilir. Kapatmak için `assets/js/views/components.js` içinde `data-needs-preview` niteliğini üreten koşulu kaldırmak yeterli.
- **Favicon'lar** `icons.duckduckgo.com` üzerinden gelir — tek üçüncü taraf istek burasıdır. İstemezsen `components.js` içindeki `faviconUrl` fonksiyonunu `null` döndürecek şekilde değiştir; monogram çapası zaten yedek olarak duruyor, arayüz aynı çalışır.
- **Isı eşikleri** `components.js` içindeki `heat()` fonksiyonunda (`rate / 50`) tek satırda ayarlanır.
- **Canlı yoklama aralıkları** `views/item.js` içinde `POLL_MS` (60 sn) ve `views/list.js` içinde `REFRESH_MS` (90 sn). İkisi de sekme arka plandayken (`document.hidden`) durur.
- **Ziyaret geçmişi** en yeni 400 gönderiyle sınırlıdır (`store.js` → `recordVisit`); tamamen yereldir, hiçbir yere gönderilmez.
- **Okuma ayarlarının varsayılanları ve sınırları** `store.js` içindeki `READING_DEFAULTS` ile `READING_LIMITS`'tedir. Değerler `applyReading()` ile kök öğeye `--read-scale`, `--read-width`, `data-density`, `data-reading` olarak yazılır; yeni bir görünümün bunları ayrıca işlemesi gerekmez, ilgili CSS kuralları zaten bu belirteçlerden okur.
- **Anket seçenekleri** gönderi başına ek istek demektir (her `pollopt` ayrı bir kayıt), ama yalnızca `type: "poll"` gönderilerde ve başlık çizildikten sonra çekilir; gönderinin görünmesini geciktirmez.

## Yerelde çalıştırma

ES modülleri kullanıldığı için dosyayı çift tıklayarak (`file://`) açmak yerine küçük bir sunucu gerekir:

```bash
python -m http.server 8080
# veya
npx serve .
```

Sonra: <http://localhost:8080>

## GitHub Pages'te yayınlama

1. Bu klasörü bir GitHub deposuna gönder:

   ```bash
   git init
   git add .
   git commit -m "Modern HN"
   git branch -M main
   git remote add origin https://github.com/<kullanici>/<depo>.git
   git push -u origin main
   ```

2. Depo → **Settings → Pages → Build and deployment → Source: GitHub Actions** seç.
   Depodaki `.github/workflows/deploy.yml` her `main` push'unda siteyi yayınlar.

   Alternatif: Source olarak **Deploy from a branch → main / (root)** de seçebilirsin; bu durumda workflow'a gerek yoktur.

3. Adres: `https://<kullanici>.github.io/<depo>/`

Tüm yollar görecelidir (`assets/...`) ve yönlendirme hash tabanlıdır (`#/item/123`), bu yüzden alt dizinde de, özel alan adında da ek ayar gerekmez. `.nojekyll` dosyası Jekyll işlemesini kapatır.

## Dosya düzeni

```
index.html                 arayüz iskeleti
assets/css/style.css       tasarım belirteçleri + tüm stiller
assets/js/api.js           HN API istemcisi (önbellek, yeniden deneme)
assets/js/store.js         tema, okuma ayarları, okunanlar, kayıtlar (localStorage)
assets/js/router.js        hash yönlendirme
assets/js/util.js          yardımcılar + HTML sanitizasyonu + istek havuzu
assets/js/app.js           kabuk: sekmeler, arama, kısayollar, yönlendirme
assets/js/views/           liste, gönderi, kullanıcı, arama görünümleri
```

## Notlar

- HN API'si kimlik doğrulama veya API anahtarı istemez, CORS açıktır; bu yüzden istekler doğrudan tarayıcıdan yapılır.
- API tek seferde toplu içerik döndürmez, her gönderi ayrı istektir. Bu yüzden istekler eşzamanlılık havuzuyla (aynı anda 8) sınırlandırılmıştır.
- Yorum metinleri HN tarafında HTML içerir; beyaz liste dışındaki etiketler `assets/js/util.js` içindeki `sanitize()` ile düz metne indirgenir.
- Bu proje Y Combinator ile ilişkili değildir.
