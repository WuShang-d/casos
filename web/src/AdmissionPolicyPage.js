import React from "react";
import {useTranslation} from "react-i18next";
import i18next from "i18next";
import CasbinRuleListPage from "./CasbinRuleListPage";

export default function AdmissionPolicyPage(props) {
  useTranslation();
  return (
    <CasbinRuleListPage
      {...props}
      scope="admission"
      title={i18next.t("general:Admission Policy")}
      description={i18next.t("policy:admission desc")}
    />
  );
}
