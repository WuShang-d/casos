import React from "react";
import {useTranslation} from "react-i18next";
import i18next from "i18next";
import CasbinRuleListPage from "./CasbinRuleListPage";

export default function AuthorizationPolicyPage(props) {
  useTranslation();
  return (
    <CasbinRuleListPage
      {...props}
      scope="authorization"
      title={i18next.t("general:Authorization Policy")}
      description={i18next.t("policy:authorization desc")}
    />
  );
}
