# Offline MedlinePlus health topics

`medlineplus-topics.json` is a compact English index derived from the U.S. National Library of Medicine's [MedlinePlus health topic XML](https://medlineplus.gov/xml.html), snapshot generated **2026-09-24 02:30:42**. It contains 1,017 topic titles, alternative names, topic groups, MedlinePlus URLs, and short plain-text excerpts from the topic summaries. MedlinePlus permits download and use of its XML files and requests attribution to **MedlinePlus.gov**. The source and snapshot date are also recorded inside the JSON. The uncompressed XML and source ZIP are not committed.

To refresh it, download the latest compressed health topic XML ZIP linked on that page, then run:

```text
python scripts/build-medlineplus-corpus.py path/to/mplus_topics_compressed_YYYY-MM-DD.zip
```

The build script uses only Python's standard library. It accepts the local ZIP and never sends user questions to MedlinePlus. The app searches the committed index locally; an answer using a matched excerpt is generated through the user's configured OpenRouter model. Excerpts may become outdated as MedlinePlus updates its pages, and they are not a substitute for clinical judgment.
