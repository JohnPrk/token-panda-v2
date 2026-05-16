use serde_json::Value;

pub const REQUIRED_COOKIE_NAMES: &[&str] = &[
    "sessionKey",
    "cf_clearance",
    "__cf_bm",
    "_cfuvid",
    "routingHint",
];

pub fn build_cookie_header(cookies: &[(String, String)]) -> String {
    let mut picked: Vec<(String, String)> = Vec::new();
    for name in REQUIRED_COOKIE_NAMES {
        if let Some((_, v)) = cookies.iter().find(|(n, _)| n == name) {
            picked.push(((*name).to_string(), v.clone()));
        }
    }
    picked
        .into_iter()
        .map(|(n, v)| format!("{}={}", n, v))
        .collect::<Vec<_>>()
        .join("; ")
}

pub fn has_required_cookies(cookies: &[(String, String)]) -> bool {
    cookies.iter().any(|(n, _)| n == "sessionKey")
}

/// Parse a raw "Cookie:" header line like `name1=v1; name2=v2; name3=v3` into
/// (name, value) pairs. Whitespace around names and between pairs is trimmed.
/// Values may contain `=` (since we split on the first `=` only) which matters
/// for cookies like `routingHint=[sk-ant-rh-...]` whose value has its own `=`
/// inside the bracket payload sometimes.
pub fn parse_raw_cookie_header(raw: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for pair in raw.split(';') {
        let trimmed = pair.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(eq_idx) = trimmed.find('=') {
            let name = trimmed[..eq_idx].trim();
            let value = trimmed[eq_idx + 1..].trim();
            if !name.is_empty() {
                out.push((name.to_string(), value.to_string()));
            }
        }
    }
    out
}

pub fn extract_org_id_from_orgs_json(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json).ok()?;
    let arr = v.as_array()?;
    for org in arr {
        let uuid = org.get("uuid").and_then(|x| x.as_str());
        if let Some(id) = uuid {
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_cookie_header_picks_only_required_names_in_canonical_order() {
        let cookies = vec![
            ("foo".into(), "bar".into()),
            ("cf_clearance".into(), "abc".into()),
            ("sessionKey".into(), "sk-ant-sid02-xxx".into()),
            ("ignored".into(), "zzz".into()),
            ("__cf_bm".into(), "bm-value".into()),
        ];
        let out = build_cookie_header(&cookies);
        assert_eq!(
            out,
            "sessionKey=sk-ant-sid02-xxx; cf_clearance=abc; __cf_bm=bm-value"
        );
    }

    #[test]
    fn build_cookie_header_handles_all_five() {
        let cookies = vec![
            ("sessionKey".into(), "s".into()),
            ("cf_clearance".into(), "c".into()),
            ("__cf_bm".into(), "b".into()),
            ("_cfuvid".into(), "u".into()),
            ("routingHint".into(), "[sk-ant-rh-abc]".into()),
        ];
        let out = build_cookie_header(&cookies);
        assert_eq!(
            out,
            "sessionKey=s; cf_clearance=c; __cf_bm=b; _cfuvid=u; routingHint=[sk-ant-rh-abc]"
        );
    }

    #[test]
    fn build_cookie_header_empty_when_no_match() {
        let cookies = vec![("foo".into(), "bar".into())];
        assert_eq!(build_cookie_header(&cookies), "");
    }

    #[test]
    fn has_required_cookies_session_key_only() {
        assert!(has_required_cookies(&[
            ("sessionKey".into(), "x".into()),
        ]));
        assert!(!has_required_cookies(&[
            ("cf_clearance".into(), "x".into()),
        ]));
        assert!(!has_required_cookies(&[]));
    }

    #[test]
    fn extract_org_id_picks_first_uuid() {
        let json = r#"[
            {"uuid":"63e058d5-142c-4368-bca3-39d64d78b4f5","name":"Main"},
            {"uuid":"another-uuid","name":"Other"}
        ]"#;
        assert_eq!(
            extract_org_id_from_orgs_json(json).as_deref(),
            Some("63e058d5-142c-4368-bca3-39d64d78b4f5")
        );
    }

    #[test]
    fn extract_org_id_returns_none_on_empty_array() {
        assert_eq!(extract_org_id_from_orgs_json("[]"), None);
    }

    #[test]
    fn extract_org_id_returns_none_on_invalid_json() {
        assert_eq!(extract_org_id_from_orgs_json("not json"), None);
        assert_eq!(extract_org_id_from_orgs_json(""), None);
        assert_eq!(extract_org_id_from_orgs_json("{}"), None);
    }

    #[test]
    fn parse_raw_cookie_header_basic() {
        let raw = "sessionKey=sk-ant-sid02-xxx; cf_clearance=abc; __cf_bm=bm";
        let parsed = parse_raw_cookie_header(raw);
        assert_eq!(
            parsed,
            vec![
                ("sessionKey".to_string(), "sk-ant-sid02-xxx".to_string()),
                ("cf_clearance".to_string(), "abc".to_string()),
                ("__cf_bm".to_string(), "bm".to_string()),
            ]
        );
    }

    #[test]
    fn parse_raw_cookie_header_trims_whitespace() {
        let raw = "  name1 = value1 ;  name2=value2  ; ";
        let parsed = parse_raw_cookie_header(raw);
        assert_eq!(
            parsed,
            vec![
                ("name1".to_string(), "value1".to_string()),
                ("name2".to_string(), "value2".to_string()),
            ]
        );
    }

    #[test]
    fn parse_raw_cookie_header_keeps_equals_in_value() {
        // routingHint 값 안에 = 가 들어있는 케이스. 첫 번째 = 에서만 분리.
        let raw = "routingHint=[sk-ant-rh-abc=def]; foo=bar";
        let parsed = parse_raw_cookie_header(raw);
        assert_eq!(
            parsed,
            vec![
                ("routingHint".to_string(), "[sk-ant-rh-abc=def]".to_string()),
                ("foo".to_string(), "bar".to_string()),
            ]
        );
    }

    #[test]
    fn parse_raw_cookie_header_skips_malformed_pairs() {
        let raw = "good=1; bad-no-equals; alsogood=2; =empty-name";
        let parsed = parse_raw_cookie_header(raw);
        assert_eq!(
            parsed,
            vec![
                ("good".to_string(), "1".to_string()),
                ("alsogood".to_string(), "2".to_string()),
            ]
        );
    }

    #[test]
    fn parse_raw_cookie_header_empty_input() {
        assert_eq!(parse_raw_cookie_header(""), vec![]);
        assert_eq!(parse_raw_cookie_header("   ;  ;"), vec![]);
    }

    #[test]
    fn parse_then_build_round_trip_picks_only_required() {
        let raw = "sessionKey=s; cf_clearance=c; ignored=x; __cf_bm=b; routingHint=[rh]; _cfuvid=u; foo=bar";
        let parsed = parse_raw_cookie_header(raw);
        let header = build_cookie_header(&parsed);
        assert_eq!(
            header,
            "sessionKey=s; cf_clearance=c; __cf_bm=b; _cfuvid=u; routingHint=[rh]"
        );
    }

    #[test]
    fn extract_org_id_skips_empty_uuid() {
        let json = r#"[{"uuid":"","name":"Empty"},{"uuid":"real-uuid","name":"R"}]"#;
        assert_eq!(
            extract_org_id_from_orgs_json(json).as_deref(),
            Some("real-uuid")
        );
    }
}
